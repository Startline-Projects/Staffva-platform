"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * The client navbar's Inbox link, with an unread count.
 *
 * The messaging review's finding: a candidate's reply reached no client
 * surface at all — nothing anywhere in the client's product changed until
 * they happened to revisit /inbox, which for a hiring conversation is
 * plausibly never. This badge is the minimum honest signal; a slow poll
 * because messages are minutes-scale events.
 */
export default function InboxLink({ className }: { className: string }) {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/messages");
        if (!res.ok) return;
        const j = await res.json();
        const total = (j.threads || []).reduce(
          (n: number, t: { unread_count?: number }) => n + (t.unread_count || 0),
          0
        );
        if (!cancelled) setUnread(total);
      } catch {
        /* keep last state */
      }
    }
    const first = setTimeout(load, 0);
    const t = setInterval(load, 90_000);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

  return (
    <Link href="/inbox" className={className} style={{ position: "relative" }}>
      Inbox
      {unread > 0 && (
        <span
          aria-label={`${unread} unread`}
          style={{
            position: "absolute",
            top: -6,
            right: -14,
            minWidth: 16,
            height: 16,
            padding: "0 4px",
            borderRadius: 999,
            background: "#FE6E3E",
            color: "#fff",
            fontSize: 10,
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
          }}
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
