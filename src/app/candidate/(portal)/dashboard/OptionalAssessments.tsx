"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * The door to the optional assessments.
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
 *  - The ENGLISH TEST does NOT set that badge and does not move you in the
 *    default completeness sort. It produces an English tier shown on your
 *    profile that clients can filter and sort by. Saying otherwise would be
 *    the exact copy-claims-what-code-doesn't defect this program keeps
 *    closing.
 */
export default function OptionalAssessments({
  hasEnglish,
  hasInterview,
  englishLocked,
  englishExhausted,
}: {
  hasEnglish: boolean;
  hasInterview: boolean;
  englishLocked: boolean;
  englishExhausted: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function launchInterview() {
    if (busy) return;
    setBusy(true);
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
      setBusy(false);
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
            <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Skills interview</p>
            <p style={{ margin: "4px 0 8px", fontSize: 13.5, color: "var(--ink-mute)" }}>
              A structured, recorded interview about the work you do. Passing
              it earns the <strong>Vetted badge</strong> — the one clients can
              see and filter on.
            </p>
            <button type="button" className="current-step-cta" onClick={launchInterview} disabled={busy}>
              <span>{busy ? "Opening…" : "Take the skills interview"}</span>
            </button>
          </div>
        )}

        {!hasEnglish && !englishExhausted && (
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>English assessment</p>
            <p style={{ margin: "4px 0 8px", fontSize: 13.5, color: "var(--ink-mute)" }}>
              Grammar, comprehension, and spoken and written sections. It puts
              an English tier on your profile that clients can filter and sort
              by, and it shows you which sections to work on.
            </p>
            {englishLocked ? (
              <span className="current-step-meta-chip">Retake not open yet</span>
            ) : (
              <Link href="/assessment" className="current-step-cta">
                <span>Take the English assessment</span>
              </Link>
            )}
          </div>
        )}
      </div>

      {error && <p style={{ marginTop: 10, fontSize: 13, color: "var(--danger)" }}>{error}</p>}
    </section>
  );
}
