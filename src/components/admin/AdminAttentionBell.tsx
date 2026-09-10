"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { DerivedAlert } from "@/lib/adminAlerts";

/**
 * What needs attention, on every page.
 *
 * Polls rather than subscribing. A Supabase realtime channel would mean adding
 * these tables to the publication and holding a socket open on every admin
 * page, to learn about conditions that change on the order of minutes — a
 * dispute being filed, a vendor going down. Sixty seconds is well inside the
 * useful resolution for all of them, and it cannot wedge.
 *
 * The bell counts conditions, not messages: there is no read state because
 * there is nothing to mark read. Each row clears itself when the thing it
 * describes is dealt with. A count that can only go down by fixing something
 * is worth more than one that can be dismissed.
 */
export default function AdminAttentionBell() {
  const pathname = usePathname();
  const [alerts, setAlerts] = useState<DerivedAlert[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/alerts");
      if (!res.ok) { setFailed(true); return; }
      const d = await res.json();
      setAlerts(Array.isArray(d?.alerts) ? d.alerts : []);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    // Both the first read and every refresh happen in a timer callback. A poll
    // is a subscription to an external system, which is what an effect is for;
    // calling load() straight from the effect body is a synchronous setState
    // and the compiler is right to reject it.
    let alive = true;
    const tick = () => { if (alive) load(); };
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 60_000);
    return () => { alive = false; clearTimeout(first); clearInterval(id); };
  }, [load]);

  // Close on a click elsewhere or on Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const urgent = alerts?.filter((a) => a.priority === "urgent").length ?? 0;
  const total = alerts?.length ?? 0;

  return (
    <div className="bell-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`bell-btn${open ? " open" : ""}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={
          failed ? "Attention: could not check"
            : total === 0 ? "Nothing needs attention"
            : `${total} ${total === 1 ? "item needs" : "items need"} attention`
        }
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {failed
          ? <span className="bell-badge unknown" aria-hidden="true">?</span>
          : total > 0 && <span className={`bell-badge${urgent > 0 ? " urgent" : ""}`} aria-hidden="true">{total}</span>}
      </button>

      {open && (
        <div className="bell-panel" role="dialog" aria-label="Needs attention">
          <div className="bell-head">
            Needs attention
            {!failed && <span className="count">{total}</span>}
          </div>

          {failed ? (
            <div className="bell-empty">
              <strong>Could not check.</strong> This is not the same as nothing being wrong —
              the count above is unknown, not zero.
              <button type="button" className="adm-btn" style={{ marginTop: 12 }} onClick={load}>Try again</button>
            </div>
          ) : alerts === null ? (
            <div className="bell-empty">Checking…</div>
          ) : alerts.length === 0 ? (
            <div className="bell-empty">
              Nothing is waiting. No profile reviews, no unrouted candidates, no open disputes, no
              ban requests, and every vendor is answering.
            </div>
          ) : (
            <ul className="bell-list">
              {alerts.map((a) => (
                <li key={a.id}>
                  <Link href={a.bellHref} className="bell-item" onClick={() => setOpen(false)}>
                    <span className={`bell-dot ${a.priority}`} aria-hidden="true" />
                    <span className="bell-item-body">
                      <span className="bell-item-title">{a.title}</span>
                      <span className="bell-item-meta">{a.meta[0]}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {!failed && alerts && alerts.length > 0 && pathname !== "/admin" && (
            <Link href="/admin" className="bell-foot" onClick={() => setOpen(false)}>
              Open the dashboard →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
