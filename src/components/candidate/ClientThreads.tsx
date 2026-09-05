"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Conversation from "@/components/inbox/Conversation";

/**
 * The candidate's half of client messaging, inside the portal messages page.
 *
 * Until this existed, a client's message landed in a table no candidate
 * surface read: the portal messages page was the specialist thread only, the
 * /inbox page was never linked from candidate chrome, and candidate email is
 * frozen — the audit's "demand side's first contact, silently swallowed."
 *
 * Candidates REPLY here, never initiate — the API enforces it (a candidate
 * send 403s unless the client wrote first), so every thread this list shows
 * is one a client already opened.
 */

interface Thread {
  thread_id: string;
  other_party_name: string;
  other_party_id: string;
  unread_count: number;
  latest_message: { body: string; created_at: string; sender_type: string };
}

export default function ClientThreads({ candidateId }: { candidateId: string }) {
  const router = useRouter();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/messages");
      if (!res.ok) return;
      const data = await res.json();
      setThreads(data.threads || []);
    } catch {
      /* the section keeps its last state */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  // Nothing to say until a client has actually written. An empty "Clients"
  // section would read as a feature that's failed to load — or worse, as a
  // promise that messages are coming.
  if (!loaded || threads.length === 0) return null;

  const active = threads.find((t) => t.thread_id === activeThreadId) ?? null;

  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Clients</h2>
      <p className="mt-1 text-sm text-gray-600">
        Conversations clients have started with you. Contact details stay out of
        messages until a contract is in place — that protects your payment.
      </p>

      <div className="mt-4 space-y-3">
        {threads.map((t) => (
          <div key={t.thread_id} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <button
              type="button"
              onClick={() => {
                const opening = activeThreadId !== t.thread_id;
                setActiveThreadId(opening ? t.thread_id : null);
                if (opening) {
                  // Opening loads the thread, which stamps read_at server-side.
                  // Clear the in-list badge immediately (a "2" glued beside the
                  // conversation someone is reading is a lie), and refresh the
                  // layout-rendered sidebar badge, which soft nav never
                  // re-runs — the same staleness the shell fixed for the
                  // specialist thread.
                  setThreads((prev) =>
                    prev.map((x) =>
                      x.thread_id === t.thread_id ? { ...x, unread_count: 0 } : x
                    )
                  );
                  setTimeout(() => router.refresh(), 1200);
                }
              }}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#1C1B1A]">
                  {t.other_party_name}
                  {t.unread_count > 0 && (
                    <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#FE6E3E] px-1.5 text-[10px] font-bold text-white">
                      {t.unread_count}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-xs text-gray-500">
                  {t.latest_message.sender_type === "candidate" ? "You: " : ""}
                  {t.latest_message.body}
                </p>
              </div>
              <span className="shrink-0 text-xs text-gray-400">
                {new Date(t.latest_message.created_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </button>
            {active?.thread_id === t.thread_id && (
              <div className="h-[420px] border-t border-gray-100">
                <Conversation
                  threadId={t.thread_id}
                  userRole="candidate"
                  candidateId={candidateId}
                  clientId={t.other_party_id}
                  isReadOnly={false}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
