"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * The Atlas dashboard tour — three spotlight stops on the live dashboard
 * (.dash-tour-* CSS extracted from the prototype).
 *
 * Two deliberate departures from the prototype:
 *  - Copy is OURS, not Atlas's. The prototype's stop 2 says pausing "hides
 *    you from search" (the exact claim the shell review flagged as false —
 *    not_available exits MATCHING only) and stop 3 invents a "first view
 *    within 24-48 hours" statistic no data backs. Every sentence below
 *    describes only what this platform actually does.
 *  - Completion persists (candidates.tour_seen_at via the ack RPC). The
 *    prototype forgets and would replay the tour every visit.
 */

interface TourStop {
  selector: string;
  arrow: "left" | "top";
  title: React.ReactNode;
  text: string;
  nextLabel: string;
  /** Skip this stop entirely when true (checked at navigation time). */
  skip?: () => boolean;
}

const STOPS: TourStop[] = [
  {
    selector: ".dash-sidebar",
    arrow: "left",
    title: (
      <>
        Your <em>new tools</em>, on the left.
      </>
    ),
    text: "Profile, find work, messages, contracts, reviews. Everything you need to run your work on StaffVA.",
    nextLabel: "Got it",
    // Under 881px the sidebar is a BOTTOM bar — spotlighting it while the
    // card says "on the left" would be wrong twice over.
    skip: () => window.innerWidth <= 880,
  },
  {
    selector: ".live-availability",
    arrow: "top",
    title: (
      <>
        You&apos;re in charge of <em>availability</em>.
      </>
    ),
    text: "Set yourself unavailable when you're booked — new matching stops, but your active work and conversations continue.",
    nextLabel: "Got it",
  },
  {
    selector: ".live-recent-card",
    arrow: "top",
    title: (
      <>
        Where the <em>action</em> shows up.
      </>
    ),
    // Says only what the card and the bell actually carry: the activity feed
    // assembles profile views, offers, and specialist messages; contract and
    // payout events ring the bell but land on their own pages.
    text: "Profile views, offers, and messages from your specialist land here. Contracts and payments ring the bell up top and live on their own tabs.",
    nextLabel: "All set",
  },
];

const PAD = 8;
const GAP = 24;
const CARD_W = 320;

export default function DashboardTour() {
  const [step, setStep] = useState(-1); // -1 = not started yet
  const [spot, setSpot] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [card, setCard] = useState<{ top: number; left: number } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const doneRef = useRef(false);

  const position = useCallback((idx: number) => {
    const target = document.querySelector(STOPS[idx].selector);
    if (!target) return false;
    const r = target.getBoundingClientRect();
    // A zero-size target (hidden at this breakpoint) can't be spotlit.
    if (r.width < 2 || r.height < 2) return false;
    const s = { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
    setSpot(s);
    const cardH = cardRef.current?.offsetHeight ?? 200;
    let top: number, left: number;
    if (STOPS[idx].arrow === "left") {
      left = s.left + s.width + GAP;
      top = Math.min(Math.max(s.top, 16), window.innerHeight - cardH - 16);
      if (left + CARD_W > window.innerWidth - 8) left = Math.max(8, window.innerWidth - CARD_W - 8);
    } else {
      top = s.top + s.height + GAP;
      left = Math.min(Math.max(s.left, 16), window.innerWidth - CARD_W - 16);
      if (top + cardH > window.innerHeight - 8) top = Math.max(8, s.top - cardH - GAP);
    }
    setCard({ top, left });
    return true;
  }, []);

  const goTo = useCallback(
    (idx: number) => {
      // Skip stops whose target doesn't exist or is collapsed (the sidebar
      // becomes a bottom bar under 880px; a card may not render at n=0).
      let i = idx;
      while (i < STOPS.length) {
        if (STOPS[i].skip?.()) {
          i++;
          continue;
        }
        const el = document.querySelector(STOPS[i].selector);
        const r = el?.getBoundingClientRect();
        if (el && r && r.width >= 2 && r.height >= 2) break;
        i++;
      }
      if (i >= STOPS.length) {
        finish();
        return;
      }
      document.querySelector(STOPS[i].selector)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setStep(i);
      // Let the smooth scroll settle before measuring — the prototype waits
      // 350ms for the same reason.
      setTimeout(() => position(i), 360);
    },
    [position]
  );

  function finish() {
    if (doneRef.current) return;
    doneRef.current = true;
    setStep(STOPS.length); // hides overlay
    // Fire-and-forget: a failed ack means the tour shows again next visit —
    // annoying, never harmful.
    createClient()
      .rpc("ack_dashboard_tour")
      .then(({ error }) => {
        if (error) console.error("[tour] ack failed:", error.message);
      });
  }

  useEffect(() => {
    const t = setTimeout(() => goTo(0), 600);
    return () => clearTimeout(t);
  }, [goTo]);

  useEffect(() => {
    if (step < 0 || step >= STOPS.length) return;
    const onMove = () => position(step);
    // Scroll too, not just resize: the spotlight is fixed-position over a
    // scrollable page, so without this one wheel tick leaves the lime ring
    // hovering over the wrong element.
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, { passive: true });
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove);
    };
  }, [step, position]);

  if (step < 0 || step >= STOPS.length || !spot || !card) return null;
  const stop = STOPS[step];

  return (
    <div className="dash-tour-overlay visible" role="dialog" aria-modal="true" aria-labelledby="dashTourTitle">
      <div
        className="dash-tour-spotlight"
        style={{ position: "fixed", top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
      />
      <div
        ref={cardRef}
        className="dash-tour-card"
        data-arrow={stop.arrow}
        style={{ position: "fixed", top: card.top, left: card.left }}
      >
        <div className="dash-tour-eyebrow">
          <span>Tour your dashboard</span>
          <span className="step-counter">
            {step + 1} of {STOPS.length}
          </span>
        </div>
        <h3 className="dash-tour-title" id="dashTourTitle">
          {stop.title}
        </h3>
        <p className="dash-tour-text">{stop.text}</p>
        <div className="dash-tour-actions">
          <button type="button" className="dash-tour-skip" onClick={finish}>
            Skip tour
          </button>
          <button
            type="button"
            className="dash-tour-next"
            onClick={() => (step === STOPS.length - 1 ? finish() : goTo(step + 1))}
          >
            <span>{stop.nextLabel}</span>
            <svg className="arrow" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
