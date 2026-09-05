"use client";

import { useState, useEffect, useRef } from "react";

interface Message {
  id: string;
  body: string;
  sender_type: string;
  created_at: string;
  read_at: string | null;
}

interface Props {
  threadId: string;
  userRole: string;
  candidateId: string;
  clientId: string;
  isReadOnly: boolean;
}

export default function Conversation({
  threadId,
  userRole,
  candidateId,
  clientId,
  isReadOnly,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [clientName, setClientName] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // A refusal belongs to the thread it happened in — switching must not
    // carry thread A's contact-filter banner over thread B's composer.
    setSendError(null);
    loadMessages();

    // Poll every 30s; pause when the tab is hidden to avoid background DB load
    function startPolling() {
      pollRef.current = setInterval(loadMessages, 30000);
    }
    function stopPolling() {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
    function onVisibility() {
      if (document.visibilityState === "visible") { loadMessages(); startPolling(); }
      else stopPolling();
    }

    startPolling();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [threadId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadMessages() {
    const res = await fetch(
      `/api/messages/thread?threadId=${encodeURIComponent(threadId)}`
    );
    if (!res.ok) return;

    const data = await res.json();
    setMessages(data.messages);
    setClientName(data.clientName);
    setCandidateName(data.candidateName);
    setLoading(false);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!newMessage.trim() || sending) return;

    setSending(true);
    setSendError(null);

    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId,
          clientId,
          body: newMessage.trim(),
        }),
      });

      if (res.ok) {
        setNewMessage("");
        await loadMessages();
      } else {
        // The refusal must reach the person. The contact-info filter returns a
        // real explanation ("contact details wait for a contract"), and a
        // silent no-op here turned it into "the button is broken".
        const j = await res.json().catch(() => ({}));
        setSendError(j.error || "Your message didn't send. Try again.");
      }
    } catch {
      setSendError("We couldn't reach the server. Check your connection and try again.");
    }

    setSending(false);
  }

  const otherName = userRole === "client" ? candidateName : clientName;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-text/60">Loading messages...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-4">
        <h2 className="font-semibold text-text">{otherName}</h2>
        {isReadOnly && (
          <p className="text-xs text-amber-600">
            {/* Was "Subscription lapsed — Resubscribe to reply." No client has
                ever had a subscription: all 24 sit at NULL, the only writer of
                that column is the Stripe webhook, and /api/stripe/checkout has
                no callers. Nothing lapsed and there is nothing to resubscribe
                to. */}
            Replying isn&apos;t available on this account yet.
          </p>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 ? (
          <p className="text-center text-sm text-text/40 py-8">
            {/* Candidates reply, never initiate — the API refuses a first
                message from them, so the invitation must not be issued. */}
            {userRole === "candidate"
              ? "You can reply here once a client has messaged you."
              : "Start the conversation by sending a message."}
          </p>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => {
              const isMine = msg.sender_type === userRole;
              const time = new Date(msg.created_at).toLocaleTimeString(
                "en-US",
                { hour: "numeric", minute: "2-digit" }
              );
              const date = new Date(msg.created_at).toLocaleDateString(
                "en-US",
                { month: "short", day: "numeric" }
              );

              return (
                <div
                  key={msg.id}
                  className={`flex ${isMine ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                      isMine
                        ? "bg-primary text-white"
                        : "bg-gray-100 text-text"
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                    <p
                      className={`mt-1 text-[10px] ${
                        isMine ? "text-white/60" : "text-text/40"
                      }`}
                    >
                      {date} {time}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      {sendError && (
        <p className="border-t border-red-100 bg-red-50 px-6 py-2 text-xs text-red-700">{sendError}</p>
      )}
      {!isReadOnly && !(userRole === "candidate" && messages.length === 0) && (
        <div className="border-t border-gray-200 px-6 py-4">
          <form onSubmit={handleSend} className="flex gap-3">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-text placeholder-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="submit"
              disabled={!newMessage.trim() || sending}
              className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-50"
            >
              {sending ? "..." : "Send"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
