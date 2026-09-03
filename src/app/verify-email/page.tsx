"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import "@/app/landing.css";
import "@/app/atlas-auth.css";

type VerifyState = "pending" | "checking" | "verified" | "already" | "expired" | "invalid" | "error";

const ARROW = (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function VerifyEmailContent() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");
  const emailParam = params.get("email") || "";

  const [state, setState] = useState<VerifyState>(token ? "checking" : "pending");
  const email = emailParam;
  const [cooldown, setCooldown] = useState(() => (params.get("sent") ? 60 : 0));
  const [resendNote, setResendNote] = useState("");
  const confirmedRef = useRef(false);

  // The seed param must not survive refreshes — it would restart a 60s
  // cooldown the server stopped enforcing long ago.
  useEffect(() => {
    if (params.get("sent")) {
      const clean = new URLSearchParams(params.toString());
      clean.delete("sent");
      router.replace(`/verify-email${clean.toString() ? `?${clean}` : ""}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A token in the URL means the user clicked the emailed link — confirm it.
  // A server hiccup is NOT an invalid link: it gets a retryable error state,
  // never copy that blames the link (and never a resend that would rotate a
  // perfectly good token).
  useEffect(() => {
    if (!token || confirmedRef.current) return;
    confirmedRef.current = true;
    let redirectTimer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        const res = await fetch("/api/auth/confirm-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) { setState("error"); return; }
        if (data?.status === "verified") {
          setState("verified");
          redirectTimer = setTimeout(() => router.push("/login?verified=true"), 2400);
        } else if (data?.status === "already") {
          setState("already");
        } else if (data?.status === "expired") {
          setState("expired");
        } else {
          setState("invalid");
        }
      } catch {
        setState("error");
      }
    })();
    return () => { if (redirectTimer) clearTimeout(redirectTimer); };
  }, [token, router]);

  // Resend cooldown ticker
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function resend() {
    if ((!email && !token) || cooldown > 0) return;
    setResendNote("");
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // From the expired state we hold a token, not an email — the server
        // resolves it without the address ever crossing the wire.
        body: JSON.stringify(email ? { email } : { token }),
      });
      if (!res.ok) {
        setResendNote(
          res.status === 429
            ? "Too many requests right now — wait a minute and try again."
            : "We couldn't resend the email. Contact support@staffva.com if it keeps failing."
        );
        return;
      }
      // The endpoint answers 200 for outcomes where nothing was sent —
      // saying "Sent" over those would strand people on a dead screen.
      const data = await res.json().catch(() => null);
      if (data?.message === "already_verified") {
        setState("already");
        return;
      }
      if (data?.message === "rate_limited") {
        setCooldown(60);
        setResendNote("A link already went out in the last minute — give it a moment, and check spam.");
        return;
      }
      setCooldown(60);
      setResendNote("Sent — give it a minute, and check spam.");
      if (state === "expired" || state === "invalid") setState("pending");
    } catch {
      setResendNote("We couldn't reach the server. Check your connection and try again.");
    }
  }

  const cooldownLabel = `${Math.floor(cooldown / 60)}:${String(cooldown % 60).padStart(2, "0")}`;

  const heading =
    state === "verified" ? <>You&apos;re <span className="serif-italic">verified</span>.</> :
    state === "already" ? <>Already <span className="serif-italic">verified</span>.</> :
    state === "expired" || state === "invalid" || state === "error" ? <>Let&apos;s try that <span className="serif-italic">again</span>.</> :
    <>Check your <span className="serif-italic">email</span>.</>;

  const lead =
    state === "pending" ? (
      <>We sent a verification link to <strong className="email-display">{email || "your email address"}</strong>. Click it to continue.</>
    ) : state === "checking" ? (
      <>Checking your verification link…</>
    ) : null;

  return (
    <main className="page page-narrow">
      <div className="signin-layout" style={{ maxWidth: "540px" }}>
        <header className="signin-header">
          <span className="pipeline-step-indicator">
            <span>StaffVA Pipeline</span>
            <span className="pipe-sep" aria-hidden></span>
            <span className="step-num">Step 1 of 10</span>
          </span>
          <h1 className="display">{heading}</h1>
          {lead && <p className="lead">{lead}</p>}
        </header>

        <div className="form-card signin-card">
          {state === "pending" && (
            <div className="signin-state state-centered">
              <div className="state-icon-xl envelope" aria-hidden>
                <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
                  <rect x="4" y="8" width="22" height="14" rx="1.5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  <path d="M4 10l11 7 11-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h2 className="state-title">One quick click to continue</h2>
              <p className="state-subtitle">
                Open your inbox and click the link we just sent. Check your spam folder if it&apos;s not there within 2 minutes.
              </p>
              <div className="info-chip" aria-label="Link expiry">
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                  <circle cx="6.5" cy="6.5" r="5.25" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M6.5 3.5v3l2 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Link expires in 24 hours
              </div>
              <div className="verify-action-stack">
                <div className="resend-row">
                  {cooldown > 0 ? (
                    <span className="resend-cooldown">
                      Resend available in <strong>{cooldownLabel}</strong>
                    </span>
                  ) : (
                    <button type="button" className="state-action-btn" onClick={resend} disabled={!email}>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                        <path d="M2 7a5 5 0 0 1 9-3l1 1.5M2 7l1.5-1.5M2 7v-2M12 7a5 5 0 0 1-9 3l-1-1.5M12 7l-1.5 1.5M12 7v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Resend verification email
                    </button>
                  )}
                </div>
                {resendNote && <p className="state-fine-print">{resendNote}</p>}
                <Link href="/signup/candidate" className="verify-change-email">
                  Wrong email? Change it →
                </Link>
              </div>
            </div>
          )}

          {state === "checking" && (
            <div className="signin-state state-centered">
              <div className="routing-pulse" aria-hidden><span></span><span></span><span></span></div>
              <h2 className="state-title">Checking your link…</h2>
            </div>
          )}

          {state === "verified" && (
            <div className="signin-state state-centered">
              <div className="success-check" aria-hidden>
                <svg width="36" height="36" viewBox="0 0 36 36" fill="none"><path d="M9 18.5 15.5 25 27 12" stroke="#0E0E0C" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
              <h2 className="state-title">Email verified.</h2>
              <p className="state-subtitle">Welcome aboard. Taking you to sign in…</p>
              <div className="routing-pulse" aria-hidden><span></span><span></span><span></span></div>
            </div>
          )}

          {state === "expired" && (
            <div className="signin-state state-centered">
              <div className="state-icon-xl danger" aria-hidden>
                <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
                  <path d="M11.5 18.5a4 4 0 0 1 0-5.65l3-3M18.5 11.5a4 4 0 0 1 0 5.65l-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="m6 6 18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <h2 className="state-title">This verification link has expired</h2>
              <p className="state-subtitle">
                Verification links are valid for 24 hours. Request a new one and we&apos;ll send it right over.
              </p>
              <button type="button" className="state-action-btn" onClick={resend} disabled={(!email && !token) || cooldown > 0}>
                {cooldown > 0 ? `Sent — resend again in ${cooldownLabel}` : "Send a new link"}
                {cooldown <= 0 && ARROW}
              </button>
              {resendNote && <p className="state-fine-print">{resendNote}</p>}
              <p className="state-fine-print">
                Or <Link href="/login">sign in</Link> if you&apos;ve already verified.
              </p>
            </div>
          )}

          {state === "already" && (
            <div className="signin-state state-centered">
              <div className="state-icon-xl done" aria-hidden>
                <svg width="30" height="30" viewBox="0 0 30 30" fill="none"><path d="M8 15.5 13 20.5 22 9.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
              <h2 className="state-title">Already verified</h2>
              <p className="state-subtitle">
                Looks like this email&apos;s already been verified. Sign in to pick up where you left off.
              </p>
              <Link href="/login" className="state-action-btn">
                Sign in
                {ARROW}
              </Link>
            </div>
          )}

          {state === "error" && (
            <div className="signin-state state-centered">
              <div className="state-icon-xl danger" aria-hidden>
                <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
                  <circle cx="15" cy="15" r="12" stroke="currentColor" strokeWidth="2" />
                  <path d="M15 9v7M15 20v.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <h2 className="state-title">Something went wrong on our side</h2>
              <p className="state-subtitle">
                Your link is probably fine — we just couldn&apos;t check it right now. Give it a minute and try again.
              </p>
              <button
                type="button"
                className="state-action-btn"
                onClick={() => { confirmedRef.current = false; setState("checking"); window.location.reload(); }}
              >
                Try again
                {ARROW}
              </button>
            </div>
          )}

          {state === "invalid" && (
            <div className="signin-state state-centered">
              <div className="state-icon-xl danger" aria-hidden>
                <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
                  <circle cx="15" cy="15" r="12" stroke="currentColor" strokeWidth="2" />
                  <path d="m10.5 10.5 9 9M19.5 10.5l-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <h2 className="state-title">This link doesn&apos;t look right</h2>
              <p className="state-subtitle">
                We couldn&apos;t recognize this verification link. It may have been used already, expired long ago, or been copied incorrectly.
              </p>
              <p className="state-subtitle">
                If you already verified, just <Link href="/login">sign in</Link>.
              </p>
              {(email || token) && (
                <button type="button" className="state-action-btn" onClick={resend} disabled={cooldown > 0}>
                  {cooldown > 0 ? `Sent — resend again in ${cooldownLabel}` : "Send a new link"}
                  {cooldown <= 0 && ARROW}
                </button>
              )}
              {resendNote && <p className="state-fine-print">{resendNote}</p>}
              <p className="state-fine-print">
                Need help? <a href="mailto:support@staffva.com">Contact support</a>.
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
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
            <span className="logo-mark" aria-hidden></span>
            <span>StaffVA</span>
          </Link>
          <div className="nav-right">
            <span className="existing-q">Already have an account?</span>
            <Link href="/login" className="signin">Sign in</Link>
          </div>
        </div>
      </nav>
      <Suspense fallback={null}>
        <VerifyEmailContent />
      </Suspense>
    </div>
  );
}
