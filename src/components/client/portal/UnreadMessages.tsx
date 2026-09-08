"use client";

import { createContext, useContext, useEffect, useState } from "react";

/**
 * The unread-message count for the client chrome, kept live.
 *
 * The layout computes the count server-side, but a layout does not re-render
 * while the client stays on one page — so on its own that number freezes the
 * moment they land. The navbar this shell replaced polled every 90 seconds
 * (InboxLink), and losing that would mean a candidate's reply changed nothing
 * anywhere in the client's product until they happened to navigate. One
 * poller feeds both the rail badge and the topbar dot; messages are
 * minutes-scale events, so the cadence stays slow.
 */
const UnreadContext = createContext<number>(0);

export function useUnreadMessages() {
  return useContext(UnreadContext);
}

export default function UnreadMessagesProvider({
  initial,
  children,
}: {
  initial: number;
  children: React.ReactNode;
}) {
  const [unread, setUnread] = useState(initial);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/messages");
        if (!res.ok) return; // keep the last known count rather than zeroing it
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
    const t = setInterval(load, 90_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return <UnreadContext.Provider value={unread}>{children}</UnreadContext.Provider>;
}
