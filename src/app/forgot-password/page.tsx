"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import "@/app/landing.css";
import "@/app/atlas-auth.css";

function emailValid(v: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

/**
 * Account recovery, screen A + B of the Atlas forgot view: request the
 * link, then the sent state with a resend cooldown. The emailed link lands
 * on /reset-password (screens C/D).
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || cooldown > 0) return;
    if (!emailValid(email)) { setInvalid(true); return; }
    setInvalid(false);
    setNote("");
    setBusy(true);
    const supabase = createClient();
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: (process.env.NEXT_PUBLIC_SITE_URL || window.location.origin) + "/reset-password",
      });
      if (error) {
        setNote(
          error.status === 429
            ? "Too many requests right now — wait a minute and try again."
            : "We couldn't send the email right now. Try again in a moment."
        );
        return;
      }
      setSent(true);
      setCooldown(60);
    } catch {
      setNote("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const cooldownLabel = `${Math.floor(cooldown / 60)}:${String(cooldown % 60).padStart(2, "0")}`;

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
            <span className="existing-q">Remembered it?</span>
            <Link href="/login" className="signin">Sign in</Link>
          </div>
        </div>
      </nav>

      <main className="page page-narrow">
        <div className="signin-layout">
          <header className="signin-header">
            <span className="eyebrow">Account recovery</span>
            <h1 className="display">Reset your <span className="serif-italic">password</span>.</h1>
            {!sent && (
              <p className="lead">Enter the email associated with your StaffVA account and we&apos;ll send you a link to set a new one.</p>
            )}
          </header>

          <div className="form-card signin-card">
            {!sent ? (
              <div className="signin-state">
                <form onSubmit={send} noValidate autoComplete="on">
                  <div className={`form-row ${invalid ? "is-invalid" : ""}`} data-field="forgotEmail">
                    <label className="field-label" htmlFor="forgotEmailInput">
                      <span>Email address</span>
                      <span className="req">Required</span>
                    </label>
                    <div className={`field-wrap ${invalid ? "is-invalid" : ""}`}>
                      <input
                        id="forgotEmailInput"
                        type="email"
                        className="input"
                        placeholder="you@example.com"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => { setEmail(e.target.value); setInvalid(false); }}
                      />
                    </div>
                    <div className="field-error-text" role="alert">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" /><path d="M6 3.5v2.5M6 8v.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
                      <span className="err-msg">Please enter a valid email address.</span>
                    </div>
                  </div>
                  {note && <p className="state-fine-print" style={{ color: "var(--danger)" }}>{note}</p>}
                  <button type="submit" className={`btn-submit ${busy ? "loading" : ""}`} disabled={!email || busy || cooldown > 0}>
                    <span className="submit-label">{cooldown > 0 ? `Resend available in ${cooldownLabel}` : "Send reset link"}</span>
                    <span className="spinner" aria-hidden></span>
                  </button>
                </form>
              </div>
            ) : (
              <div className="signin-state state-centered">
                <div className="state-icon-xl envelope" aria-hidden>
                  <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
                    <rect x="4" y="8" width="22" height="14" rx="1.5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                    <path d="M4 10l11 7 11-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <h2 className="state-title">Check your email</h2>
                <p className="state-subtitle">
                  If an account exists with <strong className="email-display">{email}</strong>, a password reset link is on its way. Check your spam folder if you don&apos;t see it within 2 minutes.
                </p>
                <div className="info-chip" aria-label="Link expiry information">
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                    <circle cx="6.5" cy="6.5" r="5.25" stroke="currentColor" strokeWidth="1.4" />
                    <path d="M6.5 3.5v3l2 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Link expires in 1 hour
                </div>
                <div className="resend-row">
                  {cooldown > 0 ? (
                    <span className="resend-cooldown">
                      Resend available in <strong>{cooldownLabel}</strong>
                    </span>
                  ) : (
                    <button type="button" className="state-action-btn" onClick={() => send()} disabled={busy}>
                      Resend email
                    </button>
                  )}
                </div>
                {note && <p className="state-fine-print" style={{ color: "var(--danger)" }}>{note}</p>}
                <p className="state-fine-print">
                  Wrong email? <button type="button" onClick={() => { setSent(false); setNote(""); }}>Try a different one</button>, or <Link href="/login">go back to sign in</Link>.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
