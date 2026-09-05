"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { computeWaiting, type ThreadMessage } from "@/lib/recruiterThread";

/**
 * The candidate's conversation with the staff member assigned to them.
 *
 * Messages arrive server-rendered; this component owns only the composer and
 * the poll. That is deliberate — the page it replaced fetched everything client
 * side and did `if (!res.ok) return;`, so a failed request painted "No messages
 * yet" over a conversation going back to April.
 *
 * What this deliberately does NOT show:
 *  - a read receipt. read_at is stamped by the GET handler, so it means "a page
 *    was loaded", not "a person read this". Five of the nine people currently
 *    waiting are marked read and have never had an answer. "Seen" would be the
 *    cruellest true-looking sentence available here.
 *  - a response-time estimate. Five replies exist in total, all on two days in
 *    April, from two of eight recruiters. There is no distribution to quote.
 */

function fmtStamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function MessageThread({
  initialMessages,
}: {
  initialMessages: ThreadMessage[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // The page's server render stamped read_at as a side effect of loading this
  // thread, but the portal chrome (sidebar badge, topbar dot) is rendered by
  // the route-group layout, which soft navigation does not re-run. One
  // refresh reconciles them; without it the badge shows the old count until a
  // hard reload.
  useEffect(() => {
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 60 seconds. About five messages a month pass through this thread, so
  // anything faster is polling an empty table. (The page this replaces said 30s
  // in a comment and used 60000.)
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const res = await fetch("/api/recruiter-messages");
        if (!res.ok) {
          // A failed refresh must not blank the history that is already on
          // screen. Say so instead of silently showing nothing.
          setLoadFailed(true);
          return;
        }
        const data = await res.json();
        setLoadFailed(false);
        if (Array.isArray(data.messages)) {
          setMessages(
            data.messages.map((m: Record<string, unknown>) => ({
              id: m.id as string,
              body: m.body as string,
              senderRole: m.sender_role === "recruiter" ? "recruiter" : "candidate",
              createdAt: m.created_at as string,
              messageType: (m.message_type as string) ?? "regular",
              authorId: (m.sender_profile_id as string) ?? null,
              // Carried through the poll. Nulling it here would replace the
              // server-rendered author with "StaffVA" after 60 seconds, which
              // is precisely the misattribution 00195 exists to prevent.
              authorName: (m.author_name as string) ?? null,
              authorPhoto: null,
            }))
          );
        }
      } catch {
        setLoadFailed(true);
      }
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/recruiter-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || "Your message didn't send. Try again.");
        return;
      }
      setDraft("");
      const j = await res.json().catch(() => ({}));
      if (j.message) {
        setMessages((prev) => [
          ...prev,
          {
            id: j.message.id,
            body: j.message.body,
            senderRole: "candidate",
            createdAt: j.message.created_at,
            messageType: j.message.message_type ?? "regular",
            authorId: null,
            authorName: null,
            authorPhoto: null,
          },
        ]);
      }
    } catch {
      // The page this replaces had no catch here, so a dropped connection left
      // the button disabled forever with nothing said.
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  // Recomputed from the messages actually on screen, using the shared
  // predicate. The server snapshot goes stale the moment the poll brings in a
  // reply: the banner would still read "Nobody has answered yet" underneath the
  // answer itself.
  const live = computeWaiting(
    messages.map((m) => ({
      senderRole: m.senderRole,
      createdAt: m.createdAt,
      messageType: m.messageType,
    }))
  );

  let lastDay = "";

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="max-h-[60vh] space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="py-12 text-center text-sm text-gray-400">No messages yet.</p>
        )}

        {messages.map((m) => {
          const isMe = m.senderRole === "candidate";
          const showDay = dayKey(m.createdAt) !== lastDay;
          lastDay = dayKey(m.createdAt);

          // An edit request is a system event the candidate triggered
          // elsewhere, not something they typed — and the approve route later
          // rewrites this row's body to append "[Approved]", so a message
          // rendered as theirs would silently change its own words.
          if (m.messageType === "edit_request") {
            return (
              <div key={m.id}>
                {showDay && (
                  <p className="py-2 text-center text-xs text-gray-400">{dayKey(m.createdAt)}</p>
                )}
                <p className="mx-auto max-w-[85%] rounded-lg bg-gray-50 px-3 py-2 text-center text-xs text-gray-500">
                  {m.body}
                </p>
              </div>
            );
          }

          return (
            <div key={m.id}>
              {showDay && (
                <p className="py-2 text-center text-xs text-gray-400">{dayKey(m.createdAt)}</p>
              )}
              <div className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                    isMe ? "bg-[#FE6E3E] text-white" : "bg-gray-100 text-[#1C1B1A]"
                  }`}
                >
                  {!isMe && (
                    // The AUTHOR, never the assignee. Attributing a reply to
                    // whoever happens to be assigned would put words in an
                    // absent colleague's mouth — see migration 00195.
                    <p className="mb-0.5 text-[11px] font-semibold text-gray-500">
                      {m.authorName ?? "StaffVA"}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap text-sm">{m.body}</p>
                  <p className={`mt-1 text-[10px] ${isMe ? "text-white/60" : "text-gray-400"}`}>
                    {/* Full date. The old page rendered time only, so a
                        141-day-old message read as "3:07 PM". */}
                    {fmtStamp(m.createdAt)}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {loadFailed && (
        <p className="border-t border-gray-100 px-4 py-2 text-xs text-amber-700">
          We couldn&apos;t refresh this conversation just now. What you see may not be current.
        </p>
      )}

      {live.awaiting && live.since && (
        <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
          {/* Read straight off created_at and sender_role. No estimate, no
              apology, no promise — just the fact. */}
          You wrote on{" "}
          {new Date(live.since).toLocaleDateString("en-US", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
          . Nobody has answered yet.
        </p>
      )}

      <div className="border-t border-gray-200 p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            maxLength={4000}
            placeholder="Write a message…"
            className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#FE6E3E] focus:outline-none"
          />
          <button
            onClick={send}
            disabled={!draft.trim() || sending}
            className="rounded-full bg-[#FE6E3E] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#E55A2B] disabled:opacity-40"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
        {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
