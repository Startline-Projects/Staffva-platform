"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ThreadList from "@/components/inbox/ThreadList";
import Conversation from "@/components/inbox/Conversation";

interface Thread {
  thread_id: string;
  other_party_name: string;
  other_party_id: string;
  unread_count: number;
  latest_message: {
    body: string;
    created_at: string;
    sender_type: string;
  };
}

function InboxContent() {
  const searchParams = useSearchParams();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // Deep links may carry either party's id or both; the API tells us which
  // side WE are (self_id), so one param is enough. Requiring both was why two
  // of the three Message buttons dead-ended on "Select a conversation".
  const queryCandidateId = searchParams.get("candidate");
  const queryClientId = searchParams.get("client");

  const loadThreads = useCallback(async () => {
    const res = await fetch("/api/messages");
    if (!res.ok) return;

    const data = await res.json();
    setThreads(data.threads);
    setUserRole(data.role);

    // The deep link picks the STARTING thread, once. Applying it on every
    // load meant clicking any other conversation flashed it for one fetch
    // round-trip and snapped back to the linked thread — the inbox was pinned
    // until the user hand-edited the URL.
    const selfId: string | null = data.self_id ?? null;
    const clientHalf = data.role === "client" ? selfId : queryClientId;
    const candidateHalf = data.role === "candidate" ? selfId : queryCandidateId;
    setActiveThreadId((current) => {
      if (current) return current;
      if (clientHalf && candidateHalf) return `${clientHalf}:${candidateHalf}`;
      return data.threads.length > 0 ? data.threads[0].thread_id : null;
    });

    setLoading(false);
  }, [queryCandidateId, queryClientId]);

  useEffect(() => {
    // Deferred a tick — the purity lint refuses setState-reachable calls in an
    // effect body (loadThreads sets four states after its await).
    const t = setTimeout(loadThreads, 0);
    return () => clearTimeout(t);
  }, [loadThreads]);

  // Extract candidate and client IDs from active thread
  let activeCandidateId = "";
  let activeClientId = "";
  if (activeThreadId) {
    const parts = activeThreadId.split(":");
    activeClientId = parts[0];
    activeCandidateId = parts[1];
  }

  // No subscription gate. The old one read clients.subscription_status —
  // a column nothing in the app can ever set to 'active' (no billing page,
  // no checkout callers) — so after a client's FIRST message their composer
  // bricked forever with "Replying isn't available on this account yet."
  // The API enforces the real rules: clients message live candidates or
  // people they work with; candidates reply, never initiate.
  const isReadOnly = false;

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-73px)] items-center justify-center">
        <p className="text-text/60">Loading inbox...</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-73px)]">
      {/* Thread list sidebar */}
      <aside className="w-80 shrink-0 border-r border-gray-200 bg-card overflow-y-auto">
        <div className="border-b border-gray-200 px-4 py-4">
          <h1 className="text-lg font-bold text-text">Inbox</h1>
        </div>
        <ThreadList
          threads={threads}
          activeThreadId={activeThreadId}
          onSelect={setActiveThreadId}
          userRole={userRole}
        />
      </aside>

      {/* Conversation area */}
      <div className="flex-1 bg-white">
        {activeThreadId ? (
          <Conversation
            threadId={activeThreadId}
            userRole={userRole}
            candidateId={activeCandidateId}
            clientId={activeClientId}
            isReadOnly={isReadOnly}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-text/40">
              Select a conversation to view messages
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function InboxPage() {
  return (
    <Suspense>
      <InboxContent />
    </Suspense>
  );
}
