"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StaffvaLogo from "@/components/landing/StaffvaLogo";
import { AstiPointChip } from "@/components/landing/Asti";
import { createClient } from "@/lib/supabase/client";
import "@/app/landing.css";
import "@/app/atlas-auth.css";

type IdState =
  | "consent"
  | "ready"
  | "processing"
  | "still_processing"
  | "verified"
  | "review"
  | "failed";

/** The processing card promises "up to 2 minutes", so the poll holds on for
 * 90 seconds before admitting it's slow — not the 30 that made the page
 * call a perfectly normal wait "longer than usual". The webhook remains the
 * writer — polling only READS (plus the server-side check-status nudges). */
const POLL_MAX_ATTEMPTS = 90;

export default function VerifyIdClient({
  candidateId,
  initialStatus,
  initiallyConsented,
  dueAt,
}: {
  candidateId: string;
  initialStatus: string;
  initiallyConsented: boolean;
  dueAt: string | null;
}) {
  const router = useRouter();

  const [state, setState] = useState<IdState>(() => {
    if (initialStatus === "passed") return "verified";
    if (initialStatus === "manual_review") return "review";
    if (initialStatus === "failed") return "failed";
    return initiallyConsented ? "ready" : "consent";
  });
  const [consentChecked, setConsentChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [processingStage, setProcessingStage] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // The 14-day window, shown honestly wherever the page can. dueAt is null
  // until the assessments complete — verifying early is allowed and fine.
  // manual_review does NOT count as overdue: the candidate acted; our (or
  // Stripe's) latency is not their lapsed deadline.
  const dueMs = dueAt ? new Date(dueAt).getTime() : null;
  const overdue = !!dueMs && dueMs < Date.now() && state !== "verified" && state !== "review";
  const daysLeft = dueMs ? Math.max(0, Math.ceil((dueMs - Date.now()) / 86400000)) : null;

  // A Back-button return from Stripe can restore this page from the
  // back/forward cache frozen mid-"starting" — a disabled spinner button
  // forever. pageshow with persisted=true is that exact signal.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  // ?id_check=returning means the user just came back from Stripe's hosted
  // flow: switch to the processing poll. Read on MOUNT, not during render —
  // the server prerender has no window and would hydrate a different state.
  // The param is stripped so a refresh doesn't restart a resolved poll.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("id_check") !== "returning") return;
    window.history.replaceState({}, "", "/verify-id");
    // failed-on-load + returning means they just RETRIED — poll the new
    // session's verdict instead of showing the stale failure.
    setState((s) => (s === "ready" || s === "consent" || s === "failed" ? "processing" : s));
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    const supabase = createClient();
    let attempts = 0;
    // Async ticks overlap: without this a slow tick resolving AFTER the
    // verdict landed would overwrite "verified" with "still_processing".
    let settled = false;
    const settle = (next: IdState) => {
      if (settled) return;
      settled = true;
      stopPolling();
      setState(next);
      if (next === "verified") router.refresh();
    };
    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const { data } = await supabase
          .from("candidates")
          .select("id_verification_status")
          .eq("id", candidateId)
          .single();
        const status = data?.id_verification_status;
        if (status === "passed") return settle("verified");
        if (status === "failed") return settle("failed");
        if (status === "manual_review") return settle("review");
        // The webhook can lag — periodically ask the server to check Stripe
        // directly. It writes with the service role; the next tick (or this
        // response) picks the verdict up.
        if (attempts === 20 || attempts === 55 || attempts === POLL_MAX_ATTEMPTS) {
          try {
            const res = await fetch("/api/identity/check-status", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ candidateId }),
            });
            const body = await res.json().catch(() => ({}));
            if (body.status === "passed") return settle("verified");
            if (body.status === "failed") return settle("failed");
          } catch {
            /* keep polling — the DB read is the fallback's fallback */
          }
        }
        if (attempts >= POLL_MAX_ATTEMPTS) settle("still_processing");
      } catch {
        if (attempts >= POLL_MAX_ATTEMPTS) settle("still_processing");
      }
    }, 1000);
  }, [candidateId, router, stopPolling]);

  useEffect(() => {
    if (state !== "processing") return;
    startPolling();
    return stopPolling;
  }, [state, startPolling, stopPolling]);

  // Purely presentational: the three stage rows light up on a timer while
  // the real verdict comes from the poll.
  useEffect(() => {
    if (state !== "processing") {
      setProcessingStage(0);
      return;
    }
    const t1 = setTimeout(() => setProcessingStage(1), 5000);
    const t2 = setTimeout(() => setProcessingStage(2), 12000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [state]);

  async function saveConsent() {
    if (!consentChecked || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/identity/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId }),
      });
      if (!res.ok) {
        setError("We couldn't save your consent. Try again.");
        return;
      }
      setState("ready");
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  // `busy` instead of a state: the button spins on whichever card the user
  // is actually on (ready OR failed), errors land back on the same card,
  // and a bfcache restore has one flag to clear.
  async function beginVerification() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/identity/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId }),
      });
      const body = await res.json().catch(() => ({}));
      if (body.alreadyVerified) {
        setState("verified");
        router.refresh();
        return;
      }
      if (body.url) {
        window.location.href = body.url;
        return; // busy stays true while the browser navigates away
      }
      setBusy(false);
      // The server's refusals carry real reasons (under review, reviewed by
      // our team, rate limited) — show them rather than a generic shrug.
      setError(
        typeof body.error === "string" && body.error
          ? body.error
          : "Identity verification is temporarily unavailable. Try again in a few minutes, or contact support@staffva.com."
      );
    } catch {
      setBusy(false);
      setError("We couldn't reach the server. Check your connection and try again.");
    }
  }

  const BACK_ARROW = (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M7.5 2.5 4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  const windowLine =
    state === "verified" ? (
      <p className="lead">All done here — your identity is confirmed.</p>
    ) : state === "review" ? (
      <p className="lead">Your submission is with our review team — nothing needed from you.</p>
    ) : overdue ? (
      <p className="lead" style={{ color: "var(--danger)" }}>
        Your 14-day window has passed — your profile is hidden from clients until you verify.
        Verifying restores it immediately.
      </p>
    ) : daysLeft !== null ? (
      <p className="lead">
        {daysLeft} day{daysLeft === 1 ? "" : "s"} left in your verification window. Takes about 2
        minutes — you&apos;ll need a government-issued ID and a working camera.
      </p>
    ) : (
      <p className="lead">
        Takes about 2 minutes. You&apos;ll need a government-issued ID and a working camera.
      </p>
    );

  return (
    <div className="lp lp-auth">
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=Geist:wght@300..900&family=Geist+Mono:wght@400..600&display=swap"
        rel="stylesheet"
      />
      <nav className="nav" id="nav">
        <div className="nav-inner">
          <Link href="/" className="logo" aria-label="StaffVA — go to homepage">
            <StaffvaLogo />
          </Link>
          <div className="nav-right">
            <Link href="/candidate/dashboard" className="signin">Dashboard</Link>
          </div>
        </div>
      </nav>

      <main className="page page-narrow">
        <div className="signin-layout" style={{ maxWidth: "560px" }}>
          <header className="signin-header">
            <Link href="/candidate/dashboard" className="back-to-dash">
              {BACK_ARROW}
              Back to dashboard
            </Link>
            <span className="pipeline-step-indicator">
              <span>StaffVA Pipeline</span>
              <span className="pipe-sep" aria-hidden></span>
              <span className="step-num">Step 8 of 10</span>
            </span>
            <h1 className="display">
              Verify your <span className="serif-italic">identity</span>.
            </h1>
            {windowLine}
          </header>

          <div className="form-card signin-card">
            {state === "consent" && (
              <div className="signin-state">
                <div className="consent-card-body">
                  <div className="consent-icon-wrap">
                    <div className="consent-icon" aria-hidden>
                      <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
                        <rect x="3" y="5" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
                        <circle cx="9.5" cy="11.5" r="2.2" stroke="currentColor" strokeWidth="1.6" />
                        <path d="M6 17.5c.7-1.8 2-2.7 3.5-2.7s2.8.9 3.5 2.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        <path d="M16 10h4M16 13h4M16 16h2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                    </div>
                  </div>
                  <h2 className="consent-title">Before we begin</h2>
                  <p className="consent-lead">
                    The next step captures your ID and a selfie. StaffVA takes this seriously —
                    here&apos;s exactly what happens with it, and your rights.
                  </p>

                  <dl className="consent-block">
                    <dt>What we collect</dt>
                    <dd>
                      Your <strong>government-issued ID</strong> and a <strong>selfie</strong>,
                      captured and processed by Stripe Identity. StaffVA stores the verification
                      result, a reference to the Stripe session, and a one-way{" "}
                      <strong>fingerprint of your document</strong> that lets us block the same ID
                      being used on another account — not the documents themselves.
                    </dd>

                    <dt>Why we collect it</dt>
                    <dd>
                      To confirm you are who you say you are, and to keep it one application per
                      person — so every profile a client sees is a real, verified human.
                    </dd>

                    <dt>How long it&apos;s kept</dt>
                    <dd>
                      Stripe retains the documents under its{" "}
                      <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer">
                        privacy policy
                      </a>
                      . You can request deletion at any time via{" "}
                      <a href="mailto:support@staffva.com">support@staffva.com</a> (subject to
                      legal retention obligations).
                    </dd>

                    <dt>Who can access it</dt>
                    <dd>
                      Stripe&apos;s automated verification, and a StaffVA reviewer only if the
                      automated check flags something for human eyes.
                    </dd>
                  </dl>

                  <div className="consent-check-row">
                    <label className="check-row" style={{ fontSize: "13px" }}>
                      <input
                        type="checkbox"
                        checked={consentChecked}
                        onChange={(e) => setConsentChecked(e.target.checked)}
                      />
                      <span className="check-box" aria-hidden></span>
                      <span>
                        I consent to identity verification as described above. I understand my
                        data is processed by Stripe and used to verify my identity and prevent
                        duplicate applications.
                      </span>
                    </label>
                  </div>

                  {error && (
                    <div className="field-error-text" role="alert" style={{ display: "block", marginBottom: "12px" }}>
                      <span className="err-msg">{error}</span>
                    </div>
                  )}

                  <div className="consent-actions">
                    <button
                      type="button"
                      className={`btn-submit${busy ? " loading" : ""}`}
                      disabled={!consentChecked || busy}
                      onClick={saveConsent}
                    >
                      <span className="submit-label">Continue</span>
                      <span className="spinner" aria-hidden></span>
                    </button>
                    <button
                      type="button"
                      className="consent-decline"
                      onClick={() => router.push("/candidate/dashboard")}
                    >
                      Not now
                    </button>
                  </div>
                </div>
              </div>
            )}

            {state === "ready" && (
              <div className="signin-state state-centered">
                <div className="consent-icon-wrap">
                  <div className="consent-icon" aria-hidden>
                    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
                      <rect x="3" y="5" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
                      <circle cx="9.5" cy="11.5" r="2.2" stroke="currentColor" strokeWidth="1.6" />
                      <path d="M6 17.5c.7-1.8 2-2.7 3.5-2.7s2.8.9 3.5 2.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      <path d="M16 10h4M16 13h4M16 16h2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </div>
                </div>
                <h2 className="state-title">Ready when you are</h2>
                <p className="state-subtitle">
                  You&apos;ll photograph your ID and take a quick selfie. Stripe Identity runs the
                  capture — have your ID on hand and find decent light.
                </p>
                <ul className="wa-benefits" aria-label="What you'll need" style={{ textAlign: "left" }}>
                  <li>
                    <CheckGlyph />
                    <span>
                      <strong>A government-issued photo ID</strong> — passport, national ID or
                      driver&apos;s license.
                    </span>
                  </li>
                  <li>
                    <CheckGlyph />
                    <span>
                      <strong>A camera</strong> — the one on this device works, or continue on
                      your phone via the QR code Stripe shows.
                    </span>
                  </li>
                </ul>
                {error && (
                  <div className="field-error-text" role="alert" style={{ display: "block", marginBottom: "12px" }}>
                    <span className="err-msg">{error}</span>
                  </div>
                )}
                <button
                  type="button"
                  className={`btn-submit${busy ? " loading" : ""}`}
                  disabled={busy}
                  onClick={beginVerification}
                >
                  <span className="submit-label">Begin verification</span>
                  <span className="spinner" aria-hidden></span>
                </button>
                <p className="state-fine-print">
                  Verified securely through Stripe Identity. We only store the result, not your
                  documents.
                </p>
              </div>
            )}

            {state === "processing" && (
              <div className="signin-state">
                <div className="processing-card">
                  <div className="processing-ring" aria-hidden></div>
                  <h2 className="state-title">Verifying your ID</h2>
                  <p className="state-subtitle">This can take up to 2 minutes. Don&apos;t close this window.</p>
                  <ol className="processing-stages" aria-live="polite">
                    {["Reading your ID", "Matching your face", "Final security checks"].map(
                      (label, i) => (
                        <li
                          key={label}
                          className={`processing-stage${i === processingStage ? " active" : i < processingStage ? " done" : ""}`}
                        >
                          <span className="processing-stage-icon" aria-hidden></span>
                          <span>{label}</span>
                        </li>
                      )
                    )}
                  </ol>
                </div>
              </div>
            )}

            {state === "still_processing" && (
              <div className="signin-state state-centered">
                <div className="state-icon-xl amber" aria-hidden>
                  <ClockGlyph />
                </div>
                <h2 className="state-title">Still verifying</h2>
                <p className="state-subtitle">
                  This is taking longer than usual — it happens when the photos need a closer
                  look. Your progress is saved: check again in a moment, or come back later —
                  your dashboard shows the result the moment it&apos;s in.
                </p>
                <button type="button" className="state-action-btn" onClick={() => setState("processing")}>
                  Check again
                </button>
              </div>
            )}

            {state === "verified" && (
              <div className="signin-state">
                <div className="reference-locked-card">
                  <div className="reference-lock-illo" aria-hidden>
                    <div className="reference-lock-ring secondary"></div>
                    <div className="reference-lock-ring"></div>
                    <div className="reference-lock-face">
                      <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
                        <circle cx="17" cy="13" r="6" stroke="currentColor" strokeWidth="2" />
                        <path d="M6.5 28c1.8-5 5.8-7.5 10.5-7.5S25.7 23 27.5 28" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </div>
                    <div className="reference-lock-ticks" aria-hidden>
                      <span></span>
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  </div>
                  <span className="reference-lock-badge">
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
                      <path d="m2.5 6 2 2 4-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Identity verified
                  </span>
                  <h2 className="state-title">You&apos;re verified.</h2>
                  <AstiPointChip label="+50 · identity verified" />
                  <p className="state-subtitle">
                    Your ID checked out — this step is done for good, and it will never hide
                    your profile. Once you&apos;re live, clients see the verified mark.
                  </p>
                  <Link href="/candidate/dashboard" className="state-action-btn" style={{ marginTop: "20px" }}>
                    Back to dashboard
                  </Link>
                </div>
              </div>
            )}

            {state === "review" && (
              <div className="signin-state state-centered">
                <div className="state-icon-xl amber" aria-hidden>
                  <ClockGlyph />
                </div>
                <h2 className="state-title">We need to double-check something</h2>
                <p className="state-subtitle">
                  Your verification needs a quick human look. Nothing to do on your end — and
                  the review <strong>doesn&apos;t hide your profile or block anything</strong>{" "}
                  while it runs.
                </p>
                <div
                  className="feedback-block"
                  style={{ margin: "14px auto 22px", maxWidth: "360px", textAlign: "left" }}
                >
                  <span className="feedback-block-label">What happens next</span>
                  <p>
                    A reviewer looks at your submission, typically within <strong>48 hours</strong>.
                    This page and your dashboard show the result the moment it&apos;s in.
                  </p>
                </div>
                <Link href="/candidate/dashboard" className="state-action-btn">
                  Back to dashboard
                </Link>
              </div>
            )}

            {state === "failed" && (
              <div className="signin-state state-centered">
                <div className="state-icon-xl amber" aria-hidden>
                  <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
                    <rect x="4" y="7" width="22" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
                    <path d="M10 13.5h4M10 17h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    <path d="m19.5 13 3.5 3.5M23 13l-3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </div>
                <h2 className="state-title">That attempt didn&apos;t go through</h2>
                <p className="state-subtitle">
                  Usually it&apos;s a blurry photo or glare. A few things that help:
                </p>
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: "4px auto 22px",
                    textAlign: "left",
                    maxWidth: "320px",
                    fontSize: "13px",
                    color: "var(--ink-soft)",
                    lineHeight: 1.7,
                  }}
                >
                  {[
                    "Find a well-lit spot — natural light works best",
                    "Place the ID on a dark, flat surface",
                    "Tilt slightly to avoid glare from screens or bulbs",
                  ].map((tip) => (
                    <li key={tip} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                      <span style={{ color: "var(--lime-deep)", fontWeight: 700 }}>·</span>
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
                {error && (
                  <div className="field-error-text" role="alert" style={{ display: "block", marginBottom: "12px" }}>
                    <span className="err-msg">{error}</span>
                  </div>
                )}
                <button
                  type="button"
                  className="state-action-btn"
                  disabled={busy}
                  onClick={beginVerification}
                >
                  {busy ? "Starting…" : "Try again"}
                </button>
                <p className="state-fine-print">
                  Still stuck? <a href="mailto:support@staffva.com">support@staffva.com</a> can
                  verify you another way.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function CheckGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="m3 7.5 2.5 2.5L11 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ClockGlyph() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
      <circle cx="15" cy="15" r="11" stroke="currentColor" strokeWidth="2" />
      <path d="M15 9v6l4 2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
