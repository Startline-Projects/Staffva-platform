"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { priceLabel, type AssessmentKind } from "@/lib/assessmentPurchase";
import { englishTestUrl } from "@/lib/englishTestHost";

/**
 * The assessment chooser — three cards the candidate picks from, and the till.
 *
 * Owner's flow (2026-09-13): after the profile is built, the candidate
 * chooses the English test, Interview 1 and Interview 2 by clicking them from
 * the dashboard. So this renders one card per assessment with its honest
 * state — not taken (start, free first sitting), taken-not-passed (retake,
 * $5 where a purchase applies, the cooldown date when the server would
 * refuse a start), passed (ticked; the skills card shows the Vetted badge),
 * and Interview 2 locked until Interview 1 is passed. It mounts on both the
 * pre-live and the live dashboard, so nothing here may assume "you're live".
 *
 * Copy rule applied here: say only what each assessment really buys.
 *  - The SKILLS INTERVIEW (Interview 2) is what sets the Vetted badge clients
 *    see and filter on (see /api/candidates is_assessed, which reads
 *    candidates.ai_interview_passed).
 *  - The ENGLISH TEST does NOT set that badge. It produces an English tier
 *    clients filter and sort by, and since the assessments-affect-ranking
 *    migration it also adds 4-12 points to search position by tier.
 *  - INTERVIEW 1 is the free behavioural round. It has no purchase flow at
 *    all — its only prize is opening Interview 2.
 *
 * MONEY COPY RULE, which matters more than the rest now that this charges
 * people: the price is stated before the button, never revealed on the
 * payment page. Passing is never implied — these are sat, not bought, and
 * the refund promise is the honest half of asking a VA in Manila for $5.
 * Free sittings route to the launch controls, never to Stripe checkout.
 */

interface EnglishState {
  /** Has sat it at all (english_mc_score present). */
  taken: boolean;
  /** Both parts ≥ 70, or a written tier on record — the gradeAttempt rule. */
  passed: boolean;
  /** The retake ladder is spent; no further sittings exist to offer. */
  exhausted: boolean;
  /** ISO instant the next sitting opens — set ONLY while in the future. */
  retakeAt: string | null;
  /** The free first sitting has not been spent, so this one costs nothing. */
  free: boolean;
  /** An unspent paid sitting is waiting. */
  paid: boolean;
  /** A payment is in flight but not confirmed. The local methods a candidate
   *  without an international card actually has settle asynchronously, and
   *  showing "Buy" through that window is how someone pays twice. */
  pending: boolean;
}

interface Interview1State {
  /** Passed, or grandfathered by pre-split skills history — the same rule the
   *  interview app forks on, so the two surfaces cannot disagree about which
   *  round a click would open. */
  done: boolean;
  /** Has sat it (interview1_completed_at present). */
  taken: boolean;
  /** ISO instant the retake opens — set ONLY while in the future. */
  retakeAt: string | null;
}

interface SkillsState {
  passed: boolean;
  /** Has sat it (ai_interview_completed_at present). */
  taken: boolean;
  /** ISO instant the retake opens — set ONLY while in the future. */
  retakeAt: string | null;
  free: boolean;
  paid: boolean;
  pending: boolean;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "14 September 2026" — built from UTC parts so the server and the browser
 *  produce the same string, and so it cannot be misread as month-first. */
function formatRetakeDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const TICK = (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
    <path d="M2.5 6.5 5 9l4.5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function OptionalAssessments({
  candidateId,
  english,
  interview1,
  skills,
}: {
  candidateId: string;
  english: EnglishState;
  interview1: Interview1State;
  skills: SkillsState;
}) {
  const [busy, setBusy] = useState<AssessmentKind | "interview-launch" | null>(null);
  const [error, setError] = useState("");
  const router = useRouter();
  /** An interview tab was opened from here this session — its result will
   *  land while this tab sits untouched. */
  const [launched, setLaunched] = useState(false);

  /**
   * Keep the cards current without a manual reload.
   *
   * The interview opens in ANOTHER TAB on another origin, so this tab never
   * learns that it finished — the /apply completion screen carried a poll
   * for exactly this ("a candidate came back to a page still offering
   * 'Start Interview 2' after they had sat it"), and these cards inherited
   * its CTAs, so they inherit the refetch too. Without it a returning
   * candidate is offered Interview 1 the interview app would now fork into
   * Interview 2, or a retake the cooldown refuses.
   *
   * router.refresh() re-runs the dashboard's server derivation, which is the
   * single source of every card state. Event-driven on focus/visibility
   * (returning from the interview tab), plus a 15s poll ONLY while a result
   * is actually expected — an interview launched from here, or a payment
   * confirming — so an idle dashboard is not re-querying all day.
   */
  const expectingChange = launched || english.pending || skills.pending;
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const poll = expectingChange ? setInterval(refresh, 15000) : null;
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      if (poll) clearInterval(poll);
    };
  }, [router, expectingChange]);

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
      if (!w) {
        setError("Your browser blocked the new tab. Allow pop-ups for staffva.com and try again.");
      } else {
        setLaunched(true);
      }
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const cardStyle: React.CSSProperties = {
    border: "1px solid var(--line)",
    borderRadius: 12,
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  };

  const doneChip = (label: string) => (
    // --success (#2E7D54, from the .lp-auth scope the portal frame carries)
    // and not --lime-deep: that token is a bright #B9D92F meant for fills —
    // as text on the chip's light ground it is unreadable.
    <span
      className="current-step-meta-chip"
      style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--success, #2E7D54)" }}
    >
      {TICK} {label}
    </span>
  );

  const titleRow = (title: string, priceNote: string | null) => (
    <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
      {title}
      {priceNote && (
        <span style={{ fontWeight: 500, color: "var(--ink-mute)" }}> — {priceNote}</span>
      )}
    </p>
  );

  const mutedNote = (text: string) => (
    <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-mute)" }}>{text}</p>
  );

  // ── English card ─────────────────────────────────────────────────────────
  // Order of states: passed > exhausted > cooldown > confirming payment >
  // startable. A card must never offer a start the server would refuse.
  const englishStartLabel = english.taken ? "Retake the English assessment" : "Start the English assessment";
  const englishCard = (
    <div style={cardStyle}>
      {titleRow(
        "English test",
        // No price note while a payment is confirming — "$5" next to a
        // sitting they have already paid for reads as a second charge.
        english.passed || english.exhausted || english.pending
          ? null
          : english.paid
            ? "paid"
            : english.free
              ? "free"
              : priceLabel("english")
      )}
      <p style={{ margin: 0, fontSize: 13, color: "var(--ink-mute)", flex: 1 }}>
        {english.passed
          ? "Passed. Clients see your English tier, filter on it, and it lifts you in search."
          : "Camera-proctored grammar, comprehension, and spoken and written sections. Passing earns an English tier clients filter on, plus +4 to +12 in search."}
      </p>
      {english.passed ? (
        <div>{doneChip("Passed")}</div>
      ) : english.exhausted ? (
        <div>
          <span className="current-step-meta-chip">No attempts left</span>
          {mutedNote("You've used all your English assessment attempts. Your profile is unaffected.")}
        </div>
      ) : english.retakeAt ? (
        <div>
          <span className="current-step-meta-chip">
            {english.taken ? "Taken — not passed. " : ""}Retake opens {formatRetakeDate(english.retakeAt)}
          </span>
        </div>
      ) : english.pending ? (
        <div>
          <span className="current-step-meta-chip">Confirming your payment</span>
          {mutedNote("Some payment methods take a little while to clear. We'll open the assessment here as soon as it lands — no need to pay again.")}
        </div>
      ) : english.paid || english.free ? (
        <div>
          {/* The assessment lives on its own host now. A plain <Link> would
              client-side navigate and never leave staffva.com, so this is a
              real anchor. */}
          <a href={englishTestUrl()} className="current-step-cta">
            <span>{englishStartLabel} — {english.free ? "free" : "paid"}</span>
          </a>
        </div>
      ) : (
        <div>
          <button
            type="button"
            className="current-step-cta"
            onClick={() => buy("english")}
            disabled={busy !== null}
          >
            <span>
              {busy === "english"
                ? "Opening checkout…"
                : `${englishStartLabel} — ${priceLabel("english")}`}
            </span>
          </button>
        </div>
      )}
    </div>
  );

  // ── Interview 1 card ─────────────────────────────────────────────────────
  // Always free, no purchase flow: the launch control is the only action.
  const interview1Card = (
    <div style={cardStyle}>
      {titleRow("Interview 1 — behavioural", interview1.done ? null : "free")}
      <p style={{ margin: 0, fontSize: 13, color: "var(--ink-mute)", flex: 1 }}>
        {interview1.done
          ? "Done. Interview 2 — the skills round that earns the Vetted badge — is open to you."
          : "A short recorded conversation about how you work — deadlines, feedback, a client who changes their mind. Passing it opens Interview 2."}
      </p>
      {interview1.done ? (
        <div>{doneChip("Complete")}</div>
      ) : interview1.retakeAt ? (
        <div>
          <span className="current-step-meta-chip">
            {interview1.taken ? "Taken — not passed. " : ""}Retake opens {formatRetakeDate(interview1.retakeAt)}
          </span>
        </div>
      ) : (
        <div>
          <button
            type="button"
            className="current-step-cta"
            onClick={launchInterview}
            disabled={busy !== null}
          >
            <span>
              {busy === "interview-launch"
                ? "Opening…"
                : `${interview1.taken ? "Retake" : "Start"} Interview 1 — free`}
            </span>
          </button>
        </div>
      )}
    </div>
  );

  // ── Interview 2 card ─────────────────────────────────────────────────────
  // The order gate outranks everything but a pass: the interview app forks on
  // interview1_passed, so offering a start (or selling a sitting) before
  // Interview 1 is cleared opens a door that will not open — see
  // checkEligibility in assessmentPurchase.ts, which refuses the same way.
  const skillsStartLabel = skills.taken ? "Retake Interview 2" : "Start Interview 2";
  const skillsCard = (
    <div style={cardStyle}>
      {titleRow(
        "Interview 2 — skills",
        // Same rule as the English title: nothing while locked behind
        // Interview 1, nothing while a payment is confirming.
        skills.passed || !interview1.done || skills.pending
          ? null
          : skills.paid
            ? "paid"
            : skills.free
              ? "free"
              : priceLabel("interview")
      )}
      <p style={{ margin: 0, fontSize: 13, color: "var(--ink-mute)", flex: 1 }}>
        {skills.passed
          ? "Passed. You hold the Vetted badge — the one clients see and filter on, and at +25 the biggest lift any assessment gives you."
          : "A recorded interview that probes the skills and tools you claimed. Passing earns the Vetted badge clients filter on — the biggest single lift any assessment gives you."}
      </p>
      {skills.passed ? (
        <div>{doneChip("Passed — Vetted badge earned")}</div>
      ) : !interview1.done ? (
        <div>
          <span className="current-step-meta-chip">Pass Interview 1 first</span>
          {mutedNote("Interview 1 is free and unlocks this one.")}
        </div>
      ) : skills.retakeAt ? (
        <div>
          <span className="current-step-meta-chip">
            {skills.taken ? "Taken — not passed. " : ""}Retake opens {formatRetakeDate(skills.retakeAt)}
          </span>
        </div>
      ) : skills.pending ? (
        <div>
          <span className="current-step-meta-chip">Confirming your payment</span>
          {mutedNote("Some payment methods take a little while to clear. We'll open the interview here as soon as it lands — no need to pay again.")}
        </div>
      ) : skills.paid || skills.free ? (
        <div>
          <button
            type="button"
            className="current-step-cta"
            onClick={launchInterview}
            disabled={busy !== null}
          >
            <span>
              {busy === "interview-launch"
                ? "Opening…"
                : `${skillsStartLabel} — ${skills.free ? "free" : "paid"}`}
            </span>
          </button>
        </div>
      ) : (
        <div>
          <button
            type="button"
            className="current-step-cta"
            onClick={() => buy("interview")}
            disabled={busy !== null}
          >
            <span>
              {busy === "interview"
                ? "Opening checkout…"
                : `${skillsStartLabel} — ${priceLabel("interview")}`}
            </span>
          </button>
        </div>
      )}
    </div>
  );

  // Only surface the refund promise where a purchase or a paid sitting is
  // actually on the table — three ticked cards don't need money copy.
  const moneyOnTable =
    (!english.passed && !english.exhausted && !english.free) ||
    (interview1.done && !skills.passed && !skills.free);

  return (
    <section
      className="panel-card assessment-cards"
      style={{ marginTop: 18 }}
      aria-labelledby="optAssessTitle"
    >
      <h3 id="optAssessTitle" style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
        Your assessments
      </h3>
      <p style={{ marginTop: 6, fontSize: 13.5, color: "var(--ink-mute)" }}>
        Optional — your profile never waits on them. Each one adds a signal
        clients filter on and lifts you in search. Your first sitting of each
        is free; retakes are {priceLabel("english")} (Interview&nbsp;1 is
        always free).
      </p>

      <div
        style={{
          marginTop: 14,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
          gap: 12,
        }}
      >
        {englishCard}
        {interview1Card}
        {skillsCard}
      </div>

      {moneyOnTable && (
        /* The honest half of charging for this. Stated up front rather than
           buried in Terms, because the failure it covers is ours and it is
           common: our own audio pipeline has lost candidates' answers before. */
        <p style={{ marginTop: 14, fontSize: 12.5, color: "var(--ink-mute)" }}>
          Payment covers one sitting. If something on our side goes wrong — the
          recording fails, the session won&apos;t start — we refund you
          automatically. You don&apos;t have to ask.
        </p>
      )}

      {error && <p style={{ marginTop: 10, fontSize: 13, color: "var(--danger)" }}>{error}</p>}
    </section>
  );
}
