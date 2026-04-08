"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

interface Message {
  id: string;
  recruiter_id: string;
  candidate_id: string;
  sender_role: "recruiter" | "candidate";
  body: string;
  created_at: string;
  read_at: string | null;
}

interface RecruiterProfile {
  full_name: string;
}

export default function RecruiterChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [recruiter, setRecruiter] = useState<RecruiterProfile | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function loadMessages() {
    const res = await fetch("/api/recruiter-messages");
    if (!res.ok) return;
    const data = await res.json();
    setMessages(data.messages || []);
  }

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Get candidate's assigned recruiter
      const { data: candidate } = await supabase
        .from("candidates")
        .select("assigned_recruiter")
        .eq("user_id", session.user.id)
        .single();

      if (candidate?.assigned_recruiter) {
        const { data: rp } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", candidate.assigned_recruiter)
          .single();
        if (rp) setRecruiter(rp);
      }

      await loadMessages();
      setLoading(false);
    }
    init();

    // Poll for new messages every 5 seconds
    const interval = setInterval(loadMessages, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!newMessage.trim() || sending) return;

    setSending(true);
    const res = await fetch("/api/recruiter-messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: newMessage.trim() }),
    });

    if (res.ok) {
      setNewMessage("");
      await loadMessages();
    }
    setSending(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" />
      </div>
    );
  }

  if (!recruiter) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <p className="text-gray-500">No recruiter assigned yet.</p>
        <Link href="/candidate/dashboard" className="mt-4 inline-block text-sm font-medium text-[#FE6E3E] hover:underline">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <Link href="/candidate/dashboard" className="shrink-0 rounded-lg p-1.5 hover:bg-gray-100 transition-colors">
          <svg className="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gray-100">
          <div className="flex h-full w-full items-center justify-center text-sm font-bold text-gray-400">
            {recruiter.full_name?.charAt(0) || "R"}
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold text-[#1C1B1A]">{recruiter.full_name}</p>
          <p className="text-xs text-gray-400">Your StaffVA Recruiter</p>
        </div>
      </div>

      {/* Messages */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="h-[60vh] overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-gray-400">No messages yet. Send a message to your recruiter.</p>
            </div>
          )}
          {messages.map((msg) => {
            const isMe = msg.sender_role === "candidate";
            return (
              <div key={msg.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${isMe ? "bg-[#FE6E3E] text-white" : "bg-gray-100 text-[#1C1B1A]"}`}>
                  <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                  <p className={`mt-1 text-[10px] ${isMe ? "text-white/60" : "text-gray-400"}`}>
                    {new Date(msg.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSend} className="border-t border-gray-200 p-3 flex gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 rounded-full border border-gray-300 px-4 py-2.5 text-sm focus:border-[#FE6E3E] focus:outline-none focus:ring-1 focus:ring-[#FE6E3E]"
          />
          <button
            type="submit"
            disabled={!newMessage.trim() || sending}
            className="shrink-0 rounded-full bg-[#FE6E3E] p-2.5 text-white hover:bg-[#E55A2B] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
