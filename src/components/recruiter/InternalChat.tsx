"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

const MANAR_ID = "73da7f50-b637-4b8d-a38e-7ae36e2acfd5";
const ADMIN_SAM_ID = "4079dce4-d571-4e96-a486-b725abd9cd9f";
const TEAM_THREAD_ID = "00000000-0000-0000-0000-000000000001";

interface InternalThread {
  id: string;
  name: string;
  is_group: boolean;
  other_profile_id: string | null;
  last_message: string | null;
  last_message_at: string;
  unread_count: number;
}

interface InternalMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  created_at: string;
  is_mine: boolean;
}

interface TeamMember {
  id: string;
  full_name: string;
  role: string;
}

interface InternalChatProps {
  isMobileFullScreen?: boolean;
}

function sortThreads(threads: InternalThread[], userProfileId: string, userRole: string): InternalThread[] {
  return [...threads].sort((a, b) => {
    // Group thread always first
    if (a.id === TEAM_THREAD_ID) return -1;
    if (b.id === TEAM_THREAD_ID) return 1;

    // Talent Specialists: Manar second, Admin third
    if (userRole === "recruiter") {
      if (a.other_profile_id === MANAR_ID) return -1;
      if (b.other_profile_id === MANAR_ID) return 1;
      if (a.other_profile_id === ADMIN_SAM_ID) return -1;
      if (b.other_profile_id === ADMIN_SAM_ID) return 1;
    }

    // Manar: Admin second
    if (userProfileId === MANAR_ID) {
      if (a.other_profile_id === ADMIN_SAM_ID) return -1;
      if (b.other_profile_id === ADMIN_SAM_ID) return 1;
    }

    // Rest by last activity
    return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
  });
}

export default function InternalChat({ isMobileFullScreen }: InternalChatProps) {
  const [token, setToken] = useState("");
  const [userProfileId, setUserProfileId] = useState("");
  const [userRole, setUserRole] = useState("");
  const [userFullName, setUserFullName] = useState("");
  const [threads, setThreads] = useState<InternalThread[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<InternalMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [creatingDm, setCreatingDm] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const realtimeRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const supabaseRef = useRef(createClient());
  const tokenRef = useRef("");

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Keep tokenRef in sync so realtime callbacks always use the latest token
  useEffect(() => { tokenRef.current = token; }, [token]);

  // Load session + threads on mount; clean up realtime channel on unmount
  useEffect(() => {
    (async () => {
      const supabase = supabaseRef.current;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setToken(session.access_token);
      setUserRole(session.user.user_metadata?.role || "");
      setUserProfileId(session.user.id);
      await fetchThreads(session.access_token);
    })();

    return () => {
      if (realtimeRef.current) {
        supabaseRef.current.removeChannel(realtimeRef.current);
        realtimeRef.current = null;
      }
    };
  }, []);

  const fetchThreads = useCallback(async (t: string) => {
    try {
      const res = await fetch("/api/internal/threads", {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.ok) {
        const data = await res.json();
        setThreads(data.threads || []);
        setTeamMembers(data.teamMembers || []);
        if (data.currentUserName) setUserFullName(data.currentUserName);
      }
    } catch { /* silent */ }
  }, []);

  async function openThread(threadId: string) {
    setActiveThreadId(threadId);
    setLoadingMessages(true);
    setMessages([]);
    setShowNewMessage(false);

    try {
      const res = await fetch(`/api/internal/threads/${threadId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch { /* silent */ }
    setLoadingMessages(false);

    // Mark as read
    fetch(`/api/internal/threads/${threadId}/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});

    // Update local unread count
    setThreads((prev) =>
      prev.map((t) => (t.id === threadId ? { ...t, unread_count: 0 } : t))
    );

    // Set up real-time subscription
    if (realtimeRef.current) {
      supabaseRef.current.removeChannel(realtimeRef.current);
    }
    const channel = supabaseRef.current
      .channel(`internal-messages-${threadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "internal_messages", filter: `thread_id=eq.${threadId}` },
        async () => {
          // Refetch messages for simplicity (we need sender_name which requires a join)
          const r = await fetch(`/api/internal/threads/${threadId}/messages`, {
            headers: { Authorization: `Bearer ${tokenRef.current}` },
          });
          if (r.ok) {
            const d = await r.json();
            setMessages(d.messages || []);
          }
          // Mark as read again
          fetch(`/api/internal/threads/${threadId}/read`, {
            method: "POST",
            headers: { Authorization: `Bearer ${tokenRef.current}` },
          }).catch(() => {});
        }
      )
      .subscribe();
    realtimeRef.current = channel;
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!newMessage.trim() || !activeThreadId || sending) return;
    setSending(true);
    const body = newMessage.trim();
    setNewMessage("");
    try {
      const res = await fetch(`/api/internal/threads/${activeThreadId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        const data = await res.json();
        const msg = data.message;
        setMessages((prev) => [
          ...prev,
          {
            id: msg.id,
            sender_id: msg.sender_id,
            sender_name: userFullName,
            body: msg.body,
            created_at: msg.created_at,
            is_mine: true,
          },
        ]);
        // Refresh threads list to update last message
        fetchThreads(token);
      }
    } catch { /* silent */ }
    setSending(false);
  }

  async function handleStartDm(memberId: string) {
    setCreatingDm(true);
    setShowNewMessage(false);
    try {
      const res = await fetch("/api/internal/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ memberId }),
      });
      if (res.ok) {
        const data = await res.json();
        await fetchThreads(token);
        openThread(data.threadId);
      }
    } catch { /* silent */ }
    setCreatingDm(false);
  }

  const canCreateDm = userRole === "admin" || userRole === "recruiting_manager";
  const activeThread = threads.find((t) => t.id === activeThreadId);
  const sortedThreads = sortThreads(threads, userProfileId, userRole);
  const totalUnread = threads.reduce((s, t) => s + t.unread_count, 0);

  return (
    <div className={`flex flex-col bg-white border-l border-gray-200 ${isMobileFullScreen ? "h-full" : "h-[calc(100vh-140px)]"}`}>
      {activeThreadId && activeThread ? (
        <>
          {/* Thread header */}
          <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3">
            <button
              onClick={() => {
                setActiveThreadId(null);
                if (realtimeRef.current) {
                  supabaseRef.current.removeChannel(realtimeRef.current);
                  realtimeRef.current = null;
                }
              }}
              className="rounded-lg p-1 hover:bg-gray-100"
            >
              <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>
            <div className="h-8 w-8 shrink-0 rounded-full bg-[#FE6E3E]/10 flex items-center justify-center">
              {activeThread.is_group ? (
                <svg className="h-4 w-4 text-[#FE6E3E]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                </svg>
              ) : (
                <span className="text-xs font-bold text-[#FE6E3E]">{activeThread.name?.[0] || "?"}</span>
              )}
            </div>
            <p className="text-sm font-semibold text-[#1C1B1A] truncate">{activeThread.name}</p>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {loadingMessages ? (
              <div className="flex items-center justify-center h-full">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-gray-400">No messages yet — say hi!</p>
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className={`flex flex-col ${msg.is_mine ? "items-end" : "items-start"}`}>
                  {/* Always show sender name in group threads; only for others in DMs */}
                  {(activeThread?.is_group || !msg.is_mine) && (
                    <p className={`text-[9px] font-semibold mb-0.5 ${msg.is_mine ? "text-[#FE6E3E]/70 mr-1" : "text-gray-400 ml-1"}`}>
                      {msg.sender_name}
                    </p>
                  )}
                  <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${msg.is_mine ? "bg-[#FE6E3E] text-white" : "bg-gray-100 text-[#1C1B1A]"}`}>
                    <p className="text-xs whitespace-pre-wrap">{msg.body}</p>
                    <p className={`mt-0.5 text-[9px] ${msg.is_mine ? "text-white/50" : "text-gray-400"}`}>
                      {new Date(msg.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSend} className="border-t border-gray-200 p-2 flex gap-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Message team..."
              className="flex-1 rounded-full border border-gray-300 px-3 py-2 text-xs focus:border-[#FE6E3E] focus:outline-none focus:ring-1 focus:ring-[#FE6E3E]"
              autoFocus
            />
            <button
              type="submit"
              disabled={!newMessage.trim() || sending}
              className="shrink-0 rounded-full bg-[#FE6E3E] p-2 text-white hover:bg-[#E55A2B] transition-colors disabled:opacity-50"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            </button>
          </form>
        </>
      ) : (
        <>
          {/* Thread list header */}
          <div className="border-b border-gray-200 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-[#1C1B1A]">Team</p>
              {totalUnread > 0 && (
                <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#FE6E3E] px-1 text-[9px] font-bold text-white">
                  {totalUnread}
                </span>
              )}
            </div>
            {canCreateDm && (
              <div className="relative">
                <button
                  onClick={() => setShowNewMessage((v) => !v)}
                  disabled={creatingDm}
                  className="flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 text-[10px] font-semibold text-gray-600 hover:border-[#FE6E3E] hover:text-[#FE6E3E] transition-colors disabled:opacity-50"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  New Message
                </button>
                {showNewMessage && teamMembers.length > 0 && (
                  <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
                    <p className="px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-gray-400">Start a conversation</p>
                    {teamMembers.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => handleStartDm(m.id)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
                      >
                        <div className="h-6 w-6 shrink-0 rounded-full bg-[#FE6E3E]/10 flex items-center justify-center text-[9px] font-bold text-[#FE6E3E]">
                          {m.full_name?.[0] || "?"}
                        </div>
                        <div>
                          <p className="text-xs font-medium text-[#1C1B1A]">{m.full_name}</p>
                          <p className="text-[9px] text-gray-400">{m.role === "recruiting_manager" ? "Manager" : "Talent Specialist"}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Thread list */}
          <div className="flex-1 overflow-y-auto">
            {sortedThreads.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-xs text-gray-400">No team conversations yet</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {sortedThreads.map((thread) => (
                  <button
                    key={thread.id}
                    onClick={() => openThread(thread.id)}
                    className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                  >
                    <div className="h-8 w-8 shrink-0 rounded-full bg-[#FE6E3E]/10 flex items-center justify-center">
                      {thread.is_group ? (
                        <svg className="h-4 w-4 text-[#FE6E3E]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                        </svg>
                      ) : (
                        <span className="text-xs font-bold text-[#FE6E3E]">{thread.name?.[0] || "?"}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-[#1C1B1A] truncate">{thread.name}</p>
                        <p className="text-[9px] text-gray-400 shrink-0 ml-1">
                          {new Date(thread.last_message_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </p>
                      </div>
                      {thread.last_message && (
                        <p className="text-[10px] text-gray-500 truncate mt-0.5">{thread.last_message}</p>
                      )}
                    </div>
                    {thread.unread_count > 0 && (
                      <span className="shrink-0 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#FE6E3E] px-1 text-[9px] font-bold text-white">
                        {thread.unread_count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
