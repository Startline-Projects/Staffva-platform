"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import StaffvaLogo from "@/components/landing/StaffvaLogo";
import { createClient } from "@/lib/supabase/client";
import "@/app/landing.css";
import "@/app/atlas-auth.css";

type SigninState = "default" | "2fa" | "lockout" | "suspended" | "routing";

/** Client-side attempt throttle: after this many failed passwords we show the
 * lockout screen with a cooldown. Supabase's own server-side rate limiting
 * still applies underneath — this is the honest UI for it. */
const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60;
const RATE_LIMIT_SECONDS = 60;
const LOCKOUT_KEY = "sva-login-lockout-until";

const ARROW = (
  <svg className="arrow" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
    <path d="M3.75 9h10.5M9.75 4.5 14.25 9l-4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function roleDestination(role: string | undefined, next: string | null): { path: string; label: string } {
  // Same-origin relative paths only. Backslashes are rejected too: the URL
  // parser treats "/\evil.com" as scheme-relative, which would make this an
  // open redirect.
  if (next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")) {
    return { path: next, label: "Taking you back to where you left off." };
  }
  switch (role) {
    case "candidate": return { path: "/candidate/dashboard", label: "Taking you to your application dashboard." };
    case "client": return { path: "/browse", label: "Taking you to the talent bench." };
    case "admin": return { path: "/admin", label: "Taking you to the admin console." };
    case "recruiter":
    case "recruiting_manager": return { path: "/recruiter", label: "Taking you to the recruiter console." };
    default: return { path: "/", label: "Taking you home." };
  }
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [state, setState] = useState<SigninState>("default");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<{ title: string; body: React.ReactNode } | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [lockoutLeft, setLockoutLeft] = useState(0);
  const [lockoutReason, setLockoutReason] = useState<"attempts" | "rate">("attempts");
  const [routingMsg, setRoutingMsg] = useState("");
  const [suspendedRef, setSuspendedRef] = useState("");

  // 2FA
  const [otp, setOtp] = useState<string[]>(["", "", "", "", "", ""]);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpBusy, setOtpBusy] = useState(false);
  const factorIdRef = useRef<string | null>(null);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  const verified = searchParams.get("verified");
  const authError = searchParams.get("error");

  // Lockout countdown
  useEffect(() => {
    if (state !== "lockout" || lockoutLeft <= 0) return;
    const t = setInterval(() => {
      setLockoutLeft((s) => {
        if (s <= 1) {
          setState("default");
          setAttempts(0);
          try { sessionStorage.removeItem(LOCKOUT_KEY); } catch {}
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [state, lockoutLeft]);

  function enterLockout(reason: "attempts" | "rate") {
    const seconds = reason === "rate" ? RATE_LIMIT_SECONDS : LOCKOUT_SECONDS;
    setLockoutReason(reason);
    setLockoutLeft(seconds);
    setState("lockout");
    try { sessionStorage.setItem(LOCKOUT_KEY, String(Date.now() + seconds * 1000)); } catch {}
  }

  // The cooldown survives a refresh — a lockout screen that a reload clears
  // is theater.
  useEffect(() => {
    try {
      const until = Number(sessionStorage.getItem(LOCKOUT_KEY) || 0);
      const left = Math.ceil((until - Date.now()) / 1000);
      if (left > 0) {
        setLockoutReason(left > RATE_LIMIT_SECONDS ? "attempts" : "rate");
        setLockoutLeft(left);
        setState("lockout");
      }
    } catch {}
     
  }, []);

  // Arriving with a session that still owes its second factor (middleware
  // sends those here as /login?mfa=1) resumes the OTP screen instead of the
  // password form — a refresh must not skip 2FA.
  useEffect(() => {
    if (searchParams.get("mfa") !== "1") return;
    (async () => {
      const supabase = createClient();
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.currentLevel === "aal1" && aal.nextLevel === "aal2") {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const totp = factors?.totp?.[0];
        if (totp) {
          factorIdRef.current = totp.id;
          setState("2fa");
          setTimeout(() => otpRefs.current[0]?.focus(), 50);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function finishSignIn(role: string | undefined) {
    const dest = roleDestination(role, searchParams.get("next"));
    setRoutingMsg(dest.label);
    setState("routing");
    setTimeout(() => router.push(dest.path), 900);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password || loading) return;
    setAlert(null);
    setLoading(true);
    const supabase = createClient();
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });

      if (signInError) {
        const isRate = signInError.status === 429 || /rate limit/i.test(signInError.message);
        const nextAttempts = attempts + 1;
        setAttempts(nextAttempts);
        if (isRate) { enterLockout("rate"); return; }
        if (nextAttempts >= MAX_ATTEMPTS) { enterLockout("attempts"); return; }
        setAlert(
          /invalid login credentials/i.test(signInError.message)
            ? { title: "Incorrect email or password.", body: <>Check your info and try again. <Link href="/forgot-password" style={{ textDecoration: "underline" }}>Forgot your password?</Link></> }
            : { title: "We couldn't sign you in.", body: signInError.message }
        );
        return;
      }

      // Email verified + account active — same checks as before, now with
      // honest screens for each.
      const checkRes = await fetch("/api/auth/check-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: data.user?.id }),
      });
      const check = await checkRes.json().catch(() => ({ verified: true, active: true }));

      if (check.verified === false) {
        await supabase.auth.signOut();
        router.push(`/verify-email?email=${encodeURIComponent(email)}`);
        return;
      }
      if (check.active === false) {
        setSuspendedRef((data.user?.id || "").slice(0, 8).toUpperCase());
        await supabase.auth.signOut();
        setState("suspended");
        return;
      }

      // Two-step verification when a TOTP factor is enrolled.
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel) {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const totp = factors?.totp?.[0];
        if (totp) {
          factorIdRef.current = totp.id;
          setOtp(["", "", "", "", "", ""]);
          setOtpError(null);
          setState("2fa");
          setTimeout(() => otpRefs.current[0]?.focus(), 50);
          return;
        }
      }

      await finishSignIn(data.user?.app_metadata?.role);
    } catch {
      setAlert({ title: "Something went wrong on our side.", body: "Check your connection and try again." });
    } finally {
      setLoading(false);
    }
  }

  async function submitOtp(codeOverride?: string) {
    const code = codeOverride ?? otp.join("");
    if (code.length !== 6 || otpBusy || !factorIdRef.current) return;
    setOtpBusy(true);
    setOtpError(null);
    const supabase = createClient();
    try {
      const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({ factorId: factorIdRef.current });
      if (chErr || !challenge) {
        setOtpError(chErr?.status === 429
          ? "Too many attempts — wait a minute, then try again."
          : "We couldn't start the check. Give it a moment and try again.");
        return;
      }
      const { data: verifyData, error: vErr } = await supabase.auth.mfa.verify({
        factorId: factorIdRef.current,
        challengeId: challenge.id,
        code,
      });
      if (vErr || !verifyData) {
        setOtpError(vErr?.status === 429
          ? "Too many attempts — wait a minute, then try again."
          : "Invalid code. Check your authenticator app and try again.");
        setOtp(["", "", "", "", "", ""]);
        setTimeout(() => otpRefs.current[0]?.focus(), 50);
        return;
      }
      const { data: userData } = await supabase.auth.getUser();
      await finishSignIn(userData.user?.app_metadata?.role);
    } catch {
      setOtpError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setOtpBusy(false);
    }
  }

  function handleOtpChange(i: number, value: string) {
    const digits = value.replace(/\D/g, "");
    // iOS/password-manager autofill drops the whole code into one box —
    // distribute it instead of keeping the last digit.
    if (digits.length > 1) {
      const nextOtp = [...otp];
      for (let k = 0; k < digits.length && i + k < 6; k++) nextOtp[i + k] = digits[k];
      setOtp(nextOtp);
      const last = Math.min(i + digits.length, 5);
      otpRefs.current[last]?.focus();
      const code = nextOtp.join("");
      if (code.length === 6) submitOtp(code);
      return;
    }
    const digit = digits.slice(-1);
    const nextOtp = [...otp];
    nextOtp[i] = digit;
    setOtp(nextOtp);
    if (digit && i < 5) otpRefs.current[i + 1]?.focus();
    const code = nextOtp.join("");
    if (code.length === 6) submitOtp(code);
  }

  function handleOtpKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !otp[i] && i > 0) {
      otpRefs.current[i - 1]?.focus();
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length === 6) {
      e.preventDefault();
      setOtp(text.split(""));
      submitOtp(text);
    }
  }



  const lockoutLabel = `${Math.floor(lockoutLeft / 60)}:${String(lockoutLeft % 60).padStart(2, "0")}`;
  const canSubmit = !!email && !!password && !loading;

  return (
    <main className="page page-narrow">
      <div className="signin-layout">
        <header className="signin-header">
          <span className="eyebrow">StaffVA · Sign in</span>
          <h1 className="display"><span className="serif-italic">Welcome</span> back.</h1>
          <p className="lead">Pick up where you left off.</p>
        </header>

        <div className="form-card signin-card">
          {state === "default" && (
            <div className="signin-state">
              {verified === "true" && (
                <div className="info-chip" style={{ alignSelf: "center", marginBottom: "16px", color: "var(--success)" }}>
                  ✓ Email verified — you can sign in now
                </div>
              )}
              {verified === "already" && (
                <div className="info-chip" style={{ alignSelf: "center", marginBottom: "16px" }}>
                  Your email is already verified — sign in below
                </div>
              )}
              {(authError === "auth" || authError === "verification" || authError === "invalid_token") && !alert && (
                <div className="form-alert visible" role="alert">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden><circle cx="9" cy="9" r="7.5" stroke="currentColor" strokeWidth="1.5" /><path d="M9 5.25v4.5M9 12.375v.375" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  <div>
                    <strong>
                      {authError === "auth" ? "Authentication failed." : "That verification link didn't work."}
                    </strong>
                    <span> {authError === "auth" ? "Please try again." : <>Request a new one from the <Link href="/verify-email">verification page</Link>.</>}</span>
                  </div>
                </div>
              )}
              {alert && (
                <div className="form-alert visible" role="alert">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden><circle cx="9" cy="9" r="7.5" stroke="currentColor" strokeWidth="1.5" /><path d="M9 5.25v4.5M9 12.375v.375" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  <div>
                    <strong>{alert.title}</strong>
                    <span> {alert.body}</span>
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} noValidate autoComplete="on">
                <div className="form-row">
                  <label className="field-label" htmlFor="signinEmail">
                    <span>Email address</span>
                    <span className="req">Required</span>
                  </label>
                  <div className="field-wrap">
                    <input
                      id="signinEmail"
                      type="email"
                      className="input"
                      placeholder="you@example.com"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <label className="field-label" htmlFor="signinPassword">
                    <span>Password</span>
                    <span className="req">Required</span>
                  </label>
                  <div className="field-wrap has-suffix">
                    <input
                      id="signinPassword"
                      type={showPassword ? "text" : "password"}
                      className="input"
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button type="button" className="field-suffix clickable" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}>
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                        {showPassword ? (
                          <path d="M2 2l14 14M6.75 6.75a2.25 2.25 0 0 0 3 3M4 4.5C2.5 5.625 1.5 9 1.5 9s2.75 5.25 7.5 5.25c1.4 0 2.75-.35 3.9-.92M11 3.9C10.35 3.77 9.7 3.75 9 3.75c-.9 0-1.77.15-2.58.42M14 6c1.4 1.25 2.5 3 2.5 3s-.65 1.2-1.9 2.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        ) : (
                          <>
                            <path d="M1.5 9s2.75-5.25 7.5-5.25S16.5 9 16.5 9s-2.75 5.25-7.5 5.25S1.5 9 1.5 9Z" stroke="currentColor" strokeWidth="1.4" />
                            <circle cx="9" cy="9" r="2.25" stroke="currentColor" strokeWidth="1.4" />
                          </>
                        )}
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="signin-util-row">
                  <span />
                  <Link href="/forgot-password" className="forgot-link">
                    Forgot password?
                  </Link>
                </div>

                <button type="submit" className={`btn-submit ${loading ? "loading" : ""}`} disabled={!canSubmit}>
                  <span className="submit-label">Sign in</span>
                  {ARROW}
                  <span className="spinner" aria-hidden></span>
                </button>
              </form>
            </div>
          )}

          {state === "2fa" && (
            <div className="signin-state">
              <button
                className="state-back"
                type="button"
                onClick={async () => {
                  // The password step already minted a half-session; leaving
                  // the challenge must abandon it, not carry it.
                  await createClient().auth.signOut();
                  setState("default");
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden><path d="M11 7H3M7 3 3 7l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Back to sign in
              </button>
              <h2 className="state-title">Two-step verification</h2>
              <p className="state-subtitle">
                Enter the 6-digit code from your authenticator app. It refreshes every 30 seconds.
              </p>
              <div className={`otp-group ${otpError ? "error" : ""}`} onPaste={handleOtpPaste}>
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => { otpRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    className="otp-input"
                    aria-label={`Digit ${i + 1}`}
                    autoComplete={i === 0 ? "one-time-code" : "off"}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                  />
                ))}
              </div>
              {otpError && (
                <div className="otp-error-text" role="alert" style={{ display: "block" }}>
                  <span>{otpError}</span>
                </div>
              )}
              <button type="button" className={`btn-submit ${otpBusy ? "loading" : ""}`} disabled={otp.join("").length !== 6 || otpBusy} onClick={() => submitOtp()}>
                <span className="submit-label">Verify</span>
                <span className="spinner" aria-hidden></span>
              </button>
            </div>
          )}

          {state === "lockout" && (
            <div className="signin-state state-centered">
              <div className="state-icon-xl amber" aria-hidden>
                <svg width="30" height="30" viewBox="0 0 30 30" fill="none"><circle cx="15" cy="15" r="12" stroke="currentColor" strokeWidth="2" /><path d="M15 8v7l4.5 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              </div>
              <h2 className="state-title">Too many sign-in attempts</h2>
              <p className="state-subtitle">
                {lockoutReason === "rate"
                  ? "Our sign-in service is seeing a lot of attempts from this network. Give it a minute and try again."
                  : "For your security, take a break before trying again. You'll be able to retry once the cooldown ends."}
              </p>
              <div className="countdown-display">
                <span className="countdown-time">{lockoutLabel}</span>
                <span className="countdown-label">Unlocks in</span>
              </div>
              <a href="mailto:support@staffva.com" className="state-action-btn">Contact support</a>
              <p className="state-fine-print">
                Forgot your password? You can still <Link href="/forgot-password">reset it</Link> — this won&apos;t affect the cooldown.
              </p>
            </div>
          )}

          {state === "suspended" && (
            <div className="signin-state state-centered">
              <div className="state-icon-xl danger" aria-hidden>
                <svg width="30" height="30" viewBox="0 0 30 30" fill="none"><circle cx="15" cy="15" r="12" stroke="currentColor" strokeWidth="2" /><path d="M6.5 6.5l17 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              </div>
              <h2 className="state-title">This account has been suspended</h2>
              <p className="state-subtitle">
                We&apos;ve paused activity on your StaffVA account pending review. If you believe this is a mistake, our support team can walk you through next steps.
              </p>
              <a href="mailto:support@staffva.com" className="state-action-btn">Contact support</a>
              {suspendedRef && (
                <p className="state-fine-print">
                  Reference ID: <span className="ref-id">SVA-ACC-{suspendedRef}</span>
                </p>
              )}
            </div>
          )}

          {state === "routing" && (
            <div className="signin-state state-centered">
              <div className="routing-pulse" aria-hidden><span></span><span></span><span></span></div>
              <h2 className="state-title">Signing you in…</h2>
              <p className="state-subtitle">{routingMsg}</p>
            </div>
          )}

        </div>

        <div className="signin-alt-actions" aria-label="Other ways to access StaffVA">
          <Link href="/signup/candidate" className="alt-action">
            <span className="alt-label">New to StaffVA?</span>
            <span className="alt-link">Create a candidate account</span>
          </Link>
          <Link href="/signup/client" className="alt-action">
            <span className="alt-label">Here to hire?</span>
            <span className="alt-link">Client sign up</span>
          </Link>
        </div>

        <div className="trust-footer" role="status" aria-label="Account security features">
          <span className="trust-item">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="M3 5.5V4a3 3 0 0 1 6 0v1.5M2 5.5h8v4.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
            Encrypted
          </span>
          <span className="trust-dot" aria-hidden></span>
          <span className="trust-item">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><circle cx="6" cy="4.5" r="2" stroke="currentColor" strokeWidth="1.2" /><path d="M2 10c.5-1.8 2-3 4-3s3.5 1.2 4 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
            Identity-verified
          </span>
          <span className="trust-dot" aria-hidden></span>
          <span className="trust-item">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden><path d="m2.5 6 2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Human-reviewed
          </span>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
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
            <span className="existing-q">New to StaffVA?</span>
            <Link href="/signup/candidate" className="signin">Apply</Link>
          </div>
        </div>
      </nav>
      <Suspense fallback={null}>
        <LoginContent />
      </Suspense>
    </div>
  );
}
