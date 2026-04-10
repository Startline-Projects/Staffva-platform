"use client";

import { useState, useEffect, useRef } from "react";

interface Notification {
  id: string;
  candidate_id: string;
  message: string;
  priority: string;
  link: string | null;
  created_at: string;
  read_at: string | null;
}

interface RecruiterNotificationBellProps {
  token: string;
}

export default function RecruiterNotificationBell({ token }: RecruiterNotificationBellProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  async function fetchNotifications() {
    if (!token) return;
    const res = await fetch("/api/recruiter/notifications", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setNotifications(data.notifications || []);
    }
  }

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Close panel on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function markRead(id: string) {
    await fetch("/api/recruiter/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ notificationId: id }),
    });
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }

  async function markAll() {
    await fetch("/api/recruiter/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ markAll: true }),
    });
    setNotifications([]);
    setOpen(false);
  }

  const count = notifications.length;
  const hasHigh = notifications.some((n) => n.priority === "high");

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-gray-500 hover:bg-gray-100 transition-colors"
        aria-label="Notifications"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        {count > 0 && (
          <span
            className={`absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white ${hasHigh ? "bg-red-500" : "bg-[#FE6E3E]"}`}
          >
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-80 rounded-xl border border-gray-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <p className="text-sm font-semibold text-[#1C1B1A]">Notifications</p>
            {count > 0 && (
              <button onClick={markAll} className="text-xs text-[#FE6E3E] hover:underline">
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
            {count === 0 && (
              <p className="px-4 py-6 text-center text-sm text-gray-400">No unread notifications</p>
            )}
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`flex items-start gap-3 px-4 py-3 ${n.priority === "high" ? "bg-red-50" : ""}`}
              >
                <div className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${n.priority === "high" ? "bg-red-500" : "bg-[#FE6E3E]"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-700 leading-relaxed">{n.message}</p>
                  {n.link && (
                    <a
                      href={n.link}
                      onClick={() => markRead(n.id)}
                      className="mt-1 inline-block text-[11px] font-medium text-[#FE6E3E] hover:underline"
                    >
                      Review now →
                    </a>
                  )}
                  <p className="mt-1 text-[10px] text-gray-400">
                    {new Date(n.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </p>
                </div>
                <button
                  onClick={() => markRead(n.id)}
                  className="shrink-0 text-gray-300 hover:text-gray-500 transition-colors"
                  aria-label="Dismiss"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
