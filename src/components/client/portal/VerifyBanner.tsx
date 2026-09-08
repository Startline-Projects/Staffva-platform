"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * The Atlas verify banner, saying the true thing.
 *
 * The prototype's reads "Complete identity verification to start hiring …
 * verification only unlocks contract sending". Both halves are wrong here by
 * the owner's own decision (D1): hiring, messaging, interviewing, proposals
 * and contracts are all open to an unverified client. Verification and a
 * card unlock FUNDING, so that is what this says.
 *
 * Dismissal is per browser session, like the prototype's — and, like the
 * prototype's, it comes back on reload, because the gate it describes is
 * still there. It hides itself on the verify page (nothing to prompt) and
 * once there is nothing left to do.
 */
const DISMISS_KEY = "sva-verify-banner-dismissed";

export default function VerifyBanner({
  needsVerification,
  needsCard,
}: {
  needsVerification: boolean;
  needsCard: boolean;
}) {
  const pathname = usePathname();
  // Starts hidden: the server cannot know what this browser dismissed, and a
  // banner that flashes in and out on every load is worse than one that
  // appears a tick late. Deferred a tick because the purity lint refuses
  // synchronous setState-reachable calls in an effect body — the same dodge
  // the notifications bell uses.
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      let hidden = false;
      try {
        hidden = sessionStorage.getItem(DISMISS_KEY) === "1";
      } catch {
        /* a session that can't remember just shows it */
      }
      setDismissed(hidden);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  if (!needsVerification && !needsCard) return null;
  if (pathname.startsWith("/verify")) return null;
  if (dismissed) return null;

  const what =
    needsVerification && needsCard
      ? "Verify your identity and add a card"
      : needsVerification
        ? "Verify your identity"
        : "Add a card";

  return (
    <div className="verify-banner" role="status">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d="M9 1.5 2.25 4.5v4.125c0 3.75 2.813 7.125 6.75 7.875 3.938-.75 6.75-4.125 6.75-7.875V4.5L9 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <span className="verify-banner-text">
        <strong>{what} to fund an engagement.</strong>{" "}
        Browsing, messaging, interviewing and signing contracts stay open
        either way — this is only about moving money.
      </span>
      <Link href="/verify" className="verify-banner-cta">
        {needsVerification ? "Verify now" : "Add a card"}
      </Link>
      <button
        type="button"
        className="verify-banner-dismiss"
        aria-label="Dismiss"
        onClick={() => {
          setDismissed(true);
          try {
            sessionStorage.setItem(DISMISS_KEY, "1");
          } catch {
            /* a session that can't remember just shows it again */
          }
        }}
      >
        ✕
      </button>
    </div>
  );
}
