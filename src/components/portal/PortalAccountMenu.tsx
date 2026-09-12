"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import PortalSignOut from "@/components/portal/PortalSignOut";

export interface AccountMenuItem {
  /** Omit to skip the row — e.g. a candidate with no public profile yet. */
  href: string | null;
  label: string;
  /** mailto: and other external targets get a plain anchor. */
  external?: boolean;
}

/**
 * The Atlas account menu.
 *
 * The prototype specifies this precisely and never built it: the topbar
 * avatar is `<button class="topbar-avatar" aria-label="Account menu">`, a
 * dropdown trigger with a hover scale — not a link. Ours was wired straight
 * to a single two-step-verification page, so the most obvious control in the
 * portal jumped you to one setting with no way back to anything else.
 *
 * Header mirrors the sidebar footer's identity block (avatar, name, status)
 * so the two agree about who you are. Closing follows the same rules as the
 * notifications dropdown: outside click and Escape, per the prototype.
 *
 * Sign-out is the shared PortalSignOut, not a second implementation. It stays
 * in the sidebar footer too, deliberately — that footer is hidden below
 * 880px, and many people here work from shared machines, so sign-out is never
 * allowed to live only behind a menu.
 */
export default function PortalAccountMenu({
  initial,
  displayName,
  statusLine,
  items,
}: {
  initial: string;
  displayName: string;
  statusLine?: string;
  items: AccountMenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="topbar-account-wrap" ref={wrapRef}>
      <button
        type="button"
        className="topbar-avatar"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {initial}
      </button>

      <div className={`account-dropdown${open ? " visible" : ""}`} role="menu">
        <header className="account-dropdown-header">
          <div className="avatar-mini" aria-hidden="true">{initial}</div>
          <div className="account-dropdown-who">
            <strong>{displayName}</strong>
            {statusLine && <span>{statusLine}</span>}
          </div>
        </header>

        <div className="account-dropdown-items">
          {items
            .filter((i) => i.href)
            .map((i) =>
              i.external ? (
                <a
                  key={i.label}
                  href={i.href as string}
                  className="account-dropdown-item"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                >
                  {i.label}
                </a>
              ) : (
                <Link
                  key={i.label}
                  href={i.href as string}
                  className="account-dropdown-item"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                >
                  {i.label}
                </Link>
              )
            )}
        </div>

        {/* A <div>, not a <footer>. landing.css carries
            `.lp footer { background: var(--ink); color: var(--paper) }` — a
            TAG selector — and the portal renders inside .lp, so a <footer>
            here came out as a black bar across the bottom of the menu. The
            notifications dropdown gets away with the same markup only because
            its one child sets its own colour. */}
        <div className="account-dropdown-footer">
          <PortalSignOut className="account-dropdown-item signout" label="Sign out" />
        </div>
      </div>
    </span>
  );
}
