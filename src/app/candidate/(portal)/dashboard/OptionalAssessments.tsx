"use client";

import Link from "next/link";
import { useState } from "react";
import { priceLabel, type AssessmentKind } from "@/lib/assessmentPurchase";
import { englishTestUrl } from "@/lib/englishTestHost";

/**
 * The door to the optional assessments — and, now, the till.
 *
 * Making them optional removed every route to them: the pipeline nodes stop
 * becoming the "current" step, so the CTA that used to launch the English
 * test and the interview vanished with it. A model whose whole premise is
 * "take these if you want to rank higher" needs somewhere to actually take
 * them from.
 *
 * Copy rule applied here: say only what each assessment really buys.
 *  - The SKILLS INTERVIEW is what sets the Vetted badge clients see and
 *    filter on (see /api/candidates is_assessed, which reads
 *    candidates.ai_interview_passed).
 *  - The ENGLISH TEST does NOT set that badge. It produces an English tier
 *    clients filter and sort by, and since the assessments-affect-ranking
 *    migration it also adds 4-12 points to search position by tier.
 *  - BOTH move a candidate up the default order (interview +25, English
 *    +12/+8/+4 on top of a 100-point profile score).
 *
 * MONEY COPY RULE, which matters more than the rest now that this charges
 * people: the price is stated before the button, never revealed on the
 * payment page. Passing is never implied — these are sat, not bought, and
 * the refund promise is the honest half of asking a VA in Manila for $5.
 */
export default function OptionalAssessments({
  candidateId,
  hasEnglish,
  hasInterview,
  englishLocked,
  englishExhausted,
  paidEnglish,
  paidInterview,
  freeEnglish,
  freeInterview,
  pendingEnglish,
  pendingInterview,
  needsInterview1,
}: {
  candidateId: string;
  hasEnglish: boolean;
  hasInterview: boolean;
  englishLocked: boolean;
  englishExhausted: boolean;
  paidEnglish: boolean;
  paidInterview: boolean;
  /** The free first sitting has not been spent yet, so this one costs
   *  nothing (20260911201321). Retakes are paid. */
  freeEnglish: boolean;
  freeInterview: boolean;
  /** A payment is in flight but not confirmed. The local methods a candidate
   *  without an international card actually has settle asynchronously, and
   *  showing "Buy" through that window is how someone pays twice. */
  pendingEnglish: boolean;
  pendingInterview: boolean;
  /** Interview 1 (behavioral, free) has not been cleared, so the paid skills
   *  interview cannot start yet — the interview app enforces the order. */
  needsInterview1: boolean;
}) {
  const [busy, setBusy] = useState<AssessmentKind | "interview-launch" | null>(null);
  const [error, setError] = useState("");

  async function buy(kind: AssessmentKind) {
    if (busy) return;
    setBusy(kind);
    setError("");
    try {
      const res = await fetch("/api/assessments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, kind }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "We couldn't start checkout. Nothing has been charged.");
        return;
      }
      // Already holding an unspent sitting — the page reload surfaces the
      // Start button instead of charging a second time.
      if (data.alreadyPaid) {
        window.location.reload();
        return;
      }
      // A payment is already confirming. Say so rather than opening a second
      // checkout: this is the normal state for the delayed local methods, and
      // the honest answer is "wait", not "pay again".
      if (data.paymentPending) {
        setError(data.error);
        return;
      }
      if (!data.url) {
        setError("We couldn't start checkout. Nothing has been charged.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("We couldn't reach the server. Nothing has been charged — check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function launchInterview() {
    if (busy) return;
    setBusy("interview-launch");
    setError("");
    try {
      const res = await fetch("/api/interview/token");
      if (!res.ok) {
        setError("We couldn't start the interview right now. Try again in a minute, or contact support@staffva.com.");
        return;
      }
      const { token } = await res.json();
      const w = window.open(`https://interview.staffva.com?token=${token}`, "_blank", "noopener,noreferrer");
      // A blocked pop-up is otherwise a silent no-op — the button appears to
      // do nothing at all.
      if (!w) setError("Your browser blocked the new tab. Allow pop-ups for staffva.com and try again.");
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  // Nothing left to offer: both taken, or English spent and interview taken.
  if ((hasEnglish || englishExhausted) && hasInterview) return null;

  return (
    <section className="panel-card" style={{ marginTop: 18 }} aria-labelledby="optAssessTitle">
      <h3 id="optAssessTitle" style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
        Optional — show clients more
      </h3>
      <p style={{ marginTop: 6, fontSize: 13.5, color: "var(--ink-mute)" }}>
        Neither of these is required to be listed. You&apos;re already live.
        They add signals to your profile and tell you where you stand.
      </p>

      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
        {!hasInterview && (
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
              {needsInterview1 ? "Interview 1" : "Skills interview"}{" "}
              <span style={{ fontWeight: 500, color: "var(--ink-mute)" }}>
                — {needsInterview1 || freeInterview ? "free" : !paidInterview ? priceLabel("interview") : ""}
              </span>
            </p>
            <p style={{ margin: "4px 0 8px", fontSize: 13.5, color: "var(--ink-mute)" }}>
              {needsInterview1 ? (
                <>
                  A short recorded conversation about how you work — how you
                  handle deadlines, feedback, and a client who changes their
                  mind. It&apos;s free, and passing it opens the{" "}
                  <strong>skills interview</strong>
                  {freeInterview ? " (your first one is free)" : ` (${priceLabel("interview")})`},
                  which is the one that earns the Vetted badge.
                </>
              ) : (
                <>
                  A structured, recorded interview about the work you do.
                  Passing it earns the <strong>Vetted badge</strong> — the one
                  clients can see and filter on, and at +25 it&apos;s the
                  biggest lift any assessment gives you — second only to having
                  a profile photo, which sorts you above every profile without
                  one. It also counts for 40% of your reputation score: without
                  it that score is capped at 60, however good your reviews are.
                </>
              )}
            </p>
            {needsInterview1 ? (
              <button
                type="button"
                className="current-step-cta"
                onClick={launchInterview}
                disabled={busy !== null}
              >
                <span>{busy === "interview-launch" ? "Opening…" : "Start Interview 1 — free"}</span>
              </button>
            ) : pendingInterview ? (
              <>
                <span className="current-step-meta-chip">Confirming your payment</span>
                <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--ink-mute)" }}>
                  Some payment methods take a little while to clear. We&apos;ll
                  open the interview here as soon as it lands — no need to pay
                  again.
                </p>
              </>
            ) : paidInterview || freeInterview ? (
              <>
                <button
                  type="button"
                  className="current-step-cta"
                  onClick={launchInterview}
                  disabled={busy !== null}
                >
                  <span>{busy === "interview-launch" ? "Opening…" : "Start your interview"}</span>
                </button>
                <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--ink-mute)" }}>
                  {freeInterview ? "Yours to take whenever you're ready." : "Paid — this is yours to take whenever you're ready."}
                </p>
              </>
            ) : (
              <button
                type="button"
                className="current-step-cta"
                onClick={() => buy("interview")}
                disabled={busy !== null}
              >
                <span>
                  {busy === "interview"
                    ? "Opening checkout…"
                    : `Retake the skills interview — ${priceLabel("interview")}`}
                </span>
              </button>
            )}
          </div>
        )}

        {!hasEnglish && !englishExhausted && (
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
              English assessment{" "}
              {!paidEnglish && (
                <span style={{ fontWeight: 500, color: "var(--ink-mute)" }}>
                  — {freeEnglish ? "free" : priceLabel("english")}
                </span>
              )}
            </p>
            <p style={{ margin: "4px 0 8px", fontSize: 13.5, color: "var(--ink-mute)" }}>
              Grammar, comprehension, and spoken and written sections. Pass
              it and you get an English tier clients filter and sort by, plus
              +4 to +12 in search depending on how well you score. Either way
              it shows you which sections to work on — and a score below the
              pass mark adds nothing and starts a retake cooldown.
            </p>
            {englishLocked ? (
              <span className="current-step-meta-chip">Retake not open yet</span>
            ) : pendingEnglish ? (
              <>
                <span className="current-step-meta-chip">Confirming your payment</span>
                <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--ink-mute)" }}>
                  Some payment methods take a little while to clear. We&apos;ll
                  open the assessment here as soon as it lands — no need to pay
                  again.
                </p>
              </>
            ) : paidEnglish || freeEnglish ? (
              <>
                {/* The assessment lives on its own host now. A plain
                    <Link> would client-side navigate and never leave
                    staffva.com, so this is a real anchor. */}
                <a href={englishTestUrl()} className="current-step-cta">
                  <span>Start your English assessment</span>
                </a>
                <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--ink-mute)" }}>
                  {freeEnglish ? "Yours to take whenever you're ready." : "Paid — this is yours to take whenever you're ready."}
                </p>
              </>
            ) : (
              <button
                type="button"
                className="current-step-cta"
                onClick={() => buy("english")}
                disabled={busy !== null}
              >
                <span>
                  {busy === "english"
                    ? "Opening checkout…"
                    : `Retake the English assessment — ${priceLabel("english")}`}
                </span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* The honest half of charging for this. Stated up front rather than
          buried in Terms, because the failure it covers is ours and it is
          common: our own audio pipeline has lost candidates' answers before. */}
      <p style={{ marginTop: 14, fontSize: 12.5, color: "var(--ink-mute)" }}>
        Payment covers one sitting. If something on our side goes wrong — the
        recording fails, the session won&apos;t start — we refund you
        automatically. You don&apos;t have to ask.
      </p>

      {error && <p style={{ marginTop: 10, fontSize: 13, color: "var(--danger)" }}>{error}</p>}
    </section>
  );
}
