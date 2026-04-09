"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface MessageThread {
  candidate_id: string;
  last_message: string;
  last_message_at: string;
  unread_count: number;
  candidate_name?: string;
  candidate_photo?: string | null;
}

interface ThreadMessage {
  id: string;
  sender_role: "recruiter" | "candidate";
  body: string;
  created_at: string;
  read_at: string | null;
}

interface MessageSidebarProps {
  threads: MessageThread[];
  candidateMap: Map<string, { name: string; photo: string | null }>;
  token: string;
  isMobileFullScreen?: boolean;
  defaultOpenCandidateId?: string | null;
  onThreadOpened?: () => void;
}

export default function MessageSidebar({ threads, candidateMap, token, isMobileFullScreen, defaultOpenCandidateId, onThreadOpened }: MessageSidebarProps) {
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const openThread = useCallback(async (candidateId: string) => {
    setActiveThread(candidateId);
    setLoading(true);
    setMessages([]);
    try {
      const res = await fetch(`/api/recruiter-messages?candidateId=${candidateId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, [token]);

  // Auto-open thread when defaultOpenCandidateId is set
  useEffect(() => {
    if (defaultOpenCandidateId && token) {
      openThread(defaultOpenCandidateId);
      onThreadOpened?.();
    }
  }, [defaultOpenCandidateId, token, openThread, onThreadOpened]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!newMessage.trim() || !activeThread || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/recruiter-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ candidateId: activeThread, body: newMessage.trim() }),
      });
      if (res.ok) {
        setNewMessage("");
        await openThread(activeThread);
      }
    } catch { /* silent */ }
    setSending(false);
  }

  const activeCandidate = activeThread ? candidateMap.get(activeThread) : null;

  return (
    <div className={`flex flex-col bg-white border-l border-gray-200 ${isMobileFullScreen ? "h-full" : "h-[calc(100vh-140px)]"}`}>
      {activeThread ? (
        <>
          {/* Thread header */}
          <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3">
            <button onClick={() => setActiveThread(null)} className="rounded-lg p-1 hover:bg-gray-100">
              <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
            </button>
            <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-gray-100">
              {activeCandidate?.photo ? (
                <img src={activeCandidate.photo} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs font-bold text-gray-400">
                  {activeCandidate?.name?.[0] || "?"}
                </div>
              )}
            </div>
            <p className="text-sm font-semibold text-[#1C1B1A] truncate">{activeCandidate?.name || "Candidate"}</p>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-gray-400">No messages yet</p>
              </div>
            ) : (
              messages.map((msg) => {
                const isMe = msg.sender_role === "recruiter";
                return (
                  <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${isMe ? "bg-[#FE6E3E] text-white" : "bg-gray-100 text-[#1C1B1A]"}`}>
                      <p className="text-xs whitespace-pre-wrap">{msg.body}</p>
                      <p className={`mt-0.5 text-[9px] ${isMe ? "text-white/50" : "text-gray-400"}`}>
                        {new Date(msg.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSend} className="border-t border-gray-200 p-2 flex gap-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 rounded-full border border-gray-300 px-3 py-2 text-xs focus:border-[#FE6E3E] focus:outline-none focus:ring-1 focus:ring-[#FE6E3E]"
            />
            <button
              type="submit"
              disabled={!newMessage.trim() || sending}
              className="shrink-0 rounded-full bg-[#FE6E3E] p-2 text-white hover:bg-[#E55A2B] transition-colors disabled:opacity-50"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
            </button>
          </form>
        </>
      ) : (
        <>
          <div className="border-b border-gray-200 px-4 py-3">
            <p className="text-sm font-semibold text-[#1C1B1A]">Messages</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {threads.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-xs text-gray-400">No conversations yet</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {threads.map((thread) => {
                  const info = candidateMap.get(thread.candidate_id);
                  return (
                    <button
                      key={thread.candidate_id}
                      onClick={() => openThread(thread.candidate_id)}
                      className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                    >
                      <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-gray-100">
                        {info?.photo ? (
                          <img src={info.photo} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-gray-400">
                            {info?.name?.[0] || "?"}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-[#1C1B1A] truncate">{info?.name || "Candidate"}</p>
                          <p className="text-[9px] text-gray-400 shrink-0 ml-1">
                            {new Date(thread.last_message_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </p>
                        </div>
                        <p className="text-[10px] text-gray-500 truncate mt-0.5">{thread.last_message}</p>
                      </div>
                      {thread.unread_count > 0 && (
                        <span className="shrink-0 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#FE6E3E] px-1 text-[9px] font-bold text-white">
                          {thread.unread_count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
