"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ThreadList from "@/components/inbox/ThreadList";
import Conversation from "@/components/inbox/Conversation";
import { createClient } from "@/lib/supabase/client";

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
  const [subscriptionStatus, setSubscriptionStatus] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // Parse query params for direct message link from profile page
  const queryCandidateId = searchParams.get("candidate");
  const queryClientId = searchParams.get("client");

  const loadThreads = useCallback(async () => {
    const res = await fetch("/api/messages");
    if (!res.ok) return;

    const data = await res.json();
    setThreads(data.threads);
    setUserRole(data.role);

    // If coming from profile page with candidate+client params, open that thread
    if (queryCandidateId && queryClientId) {
      const threadId = `${queryClientId}:${queryCandidateId}`;
      setActiveThreadId(threadId);
    } else if (data.threads.length > 0 && !activeThreadId) {
      setActiveThreadId(data.threads[0].thread_id);
    }

    setLoading(false);
  }, [queryCandidateId, queryClientId, activeThreadId]);

  useEffect(() => {
    loadThreads();

    // Check subscription status for clients
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.user_metadata?.role === "client") {
        supabase
          .from("clients")
          .select("subscription_status")
          .eq("user_id", user.id)
          .single()
          .then(({ data }) => {
            setSubscriptionStatus(data?.subscription_status || "inactive");
          });
      } else {
        setSubscriptionStatus("active"); // Candidates always have access
      }
    });
  }, [loadThreads]);

  // Extract candidate and client IDs from active thread
  let activeCandidateId = "";
  let activeClientId = "";
  if (activeThreadId) {
    const parts = activeThreadId.split(":");
    activeClientId = parts[0];
    activeCandidateId = parts[1];
  }

  const isReadOnly =
    userRole === "client" && subscriptionStatus !== "active";

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
