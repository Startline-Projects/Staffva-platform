"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ThreadMessage } from "@/lib/recruiterThread";

/**
 * Read a waiting thread and answer it, inline on the triage screen.
 *
 * The reply is attributed to whoever is signed in, not to the candidate's
 * assigned specialist — see migration 00195. Seven of the eight assigned
 * specialists have not signed in since April, so in practice the person
 * answering will not be the person the thread belongs to, and the candidate must
 * see the name of whoever actually wrote to them.
 */
export default function AdminMessageReply({
  candidateId,
  candidateName,
}: {
  candidateId: string;
  candidateName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || messages) return;
    setLoadError(null);
    try {
      const res = await fetch(`/api/admin/messages?candidateId=${encodeURIComponent(candidateId)}`);
      if (!res.ok) {
        // Never render an empty thread on a failed read — these conversations
        // are the evidence of what was asked.
        setLoadError("Could not load this conversation.");
        return;
      }
      const j = await res.json();
      setMessages(j.messages ?? []);
    } catch {
      setLoadError("Could not load this conversation.");
    }
  }

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, body }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "Could not send.");
        return;
      }
      setDraft("");
      setSent(true);
      const j = await res.json().catch(() => ({}));
      if (j.message) {
        setMessages((prev) => [
          ...(prev ?? []),
          {
            id: j.message.id,
            body: j.message.body,
            senderRole: "recruiter",
            createdAt: j.message.created_at,
            messageType: "regular",
            authorId: null,
            authorName: "You",
            authorPhoto: null,
          },
        ]);
      }
      // Last, after the response is consumed. The page is force-dynamic, so
      // this re-runs loadAwaitingThreads and the thread leaves the queue —
      // without it the person you just answered stays on the list and the next
      // reader answers them again.
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <button
        onClick={toggle}
        className="text-xs font-semibold text-[#FE6E3E] hover:underline"
      >
        {open ? "Hide conversation" : `Read and reply to ${candidateName}`}
      </button>

      {open && (
        <div className="mt-3">
          {loadError && <p className="text-xs text-red-600">{loadError}</p>}

          {messages && messages.length > 0 && (
            <div className="mb-3 max-h-64 space-y-2 overflow-y-auto rounded-lg bg-gray-50 p-3">
              {messages.map((m) => (
                <div key={m.id} className="text-sm">
                  <p className="text-[11px] font-semibold text-gray-500">
                    {m.senderRole === "candidate" ? candidateName : m.authorName ?? "StaffVA"}
                    {" · "}
                    {new Date(m.createdAt).toLocaleDateString("en-US", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                  <p className="whitespace-pre-wrap text-gray-800">{m.body}</p>
                </div>
              ))}
            </div>
          )}

          {messages && messages.length === 0 && !loadError && (
            <p className="mb-3 text-xs text-gray-400">No messages.</p>
          )}

          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder={`Reply to ${candidateName}…`}
              className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#FE6E3E] focus:outline-none"
            />
            <button
              onClick={send}
              disabled={!draft.trim() || sending}
              className="rounded-full bg-[#FE6E3E] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#E55A2B] disabled:opacity-40"
            >
              {sending ? "Sending…" : "Reply"}
            </button>
          </div>
          {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
          {sent && !error && (
            <p className="mt-1.5 text-xs text-green-700">
              Sent. It appears in their portal — candidate email is frozen, so no
              notification goes out.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
