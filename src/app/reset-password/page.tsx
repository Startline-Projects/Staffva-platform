"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import StaffvaLogo from "@/components/landing/StaffvaLogo";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import "@/app/landing.css";
import "@/app/atlas-auth.css";

type ResetState = "checking" | "mfa" | "form" | "success" | "token-error" | "suspended";

function evaluatePassword(val: string) {
  return {
    length: val.length >= 8,
    upper: /[A-Z]/.test(val),
    lower: /[a-z]/.test(val),
    number: /[0-9]/.test(val),
    special: /[^A-Za-z0-9]/.test(val),
  };
}
const PWD_RULES: { key: keyof ReturnType<typeof evaluatePassword>; label: string }[] = [
  { key: "length", label: "At least 8 characters" },
  { key: "upper", label: "One uppercase letter" },
  { key: "lower", label: "One lowercase letter" },
  { key: "number", label: "One number" },
  { key: "special", label: "One symbol (e.g. ! @ #)" },
];

/**
 * Screens C/D of the Atlas forgot view: the emailed recovery link lands
 * here. A recovery session is aal1 — for accounts with a verified TOTP
 * factor, GoTrue refuses updateUser until the second factor is presented,
 * so this page challenges the code FIRST and only then shows the form.
 * Suspension is re-checked too: recovery must not be a sign-in side door.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [state, setState] = useState<ResetState>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const factorIdRef = useRef<string | null>(null);
  const checkedRef = useRef(false);

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    (async () => {
      const supabase = createClient();
      // PKCE links carry a ?code= that only exchanges in the browser that
      // requested the reset (the verifier lives in its cookies). Exchange
      // explicitly so a race with auto-detection can't misreport the link.
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        try { await supabase.auth.exchangeCodeForSession(code); } catch { /* falls through to the poll */ }
      }
      // The recovery link puts tokens in the URL; give the client a beat to
      // ingest them before declaring the link dead.
      for (let attempt = 0; attempt < 6; attempt++) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          // Suspended accounts don't get to mint working sessions here.
          try {
            const res = await fetch("/api/auth/check-verification", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId: session.user.id }),
            });
            const check = await res.json().catch(() => ({ active: true }));
            if (check.active === false) {
              await supabase.auth.signOut();
              setState("suspended");
              return;
            }
          } catch { /* fail open, same policy as login */ }

          const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
          if (aal && aal.currentLevel === "aal1" && aal.nextLevel === "aal2") {
            const { data: factors } = await supabase.auth.mfa.listFactors();
            const totp = factors?.totp?.[0];
            if (totp) {
              factorIdRef.current = totp.id;
              setState("mfa");
              return;
            }
          }
          setState("form");
          return;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      setState("token-error");
    })();
  }, []);

  async function verifyMfa(e: React.FormEvent) {
    e.preventDefault();
    if (mfaCode.length !== 6 || busy || !factorIdRef.current) return;
    setBusy(true);
    setError("");
    const supabase = createClient();
    try {
      const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({ factorId: factorIdRef.current });
      if (chErr || !challenge) { setError("Couldn't start the check — try again in a moment."); return; }
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId: factorIdRef.current,
        challengeId: challenge.id,
        code: mfaCode,
      });
      if (vErr) {
        setError(vErr.status === 429 ? "Too many attempts — wait a minute." : "Invalid code. Check your authenticator app.");
        setMfaCode("");
        return;
      }
      setState("form");
    } catch {
      setError("We couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pwd = evaluatePassword(password);
    if (!Object.values(pwd).every(Boolean)) { setError("Password must meet all the criteria."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setError("");
    setBusy(true);
    const supabase = createClient();
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(
          /aal2|assurance/i.test(updateError.message)
            ? "This account has two-step verification — refresh and enter your code first."
            : updateError.message
        );
        return;
      }
      // A fresh password means a fresh sign-in — don't leave the recovery
      // session lying around.
      await supabase.auth.signOut();
      setState("success");
      setTimeout(() => router.push("/login"), 2600);
    } catch {
      setError("We couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const pwd = evaluatePassword(password);
  const metCount = Object.values(pwd).filter(Boolean).length;
  const strength = metCount >= 5 ? "strong" : metCount >= 3 ? "medium" : "weak";
  const strengthLabel = metCount >= 5 ? "Strong" : metCount >= 3 ? "Medium" : "Weak";
  const bothFilled = password.length > 0 && confirm.length > 0;
  const matches = password === confirm;

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
            <span className="existing-q">Remembered it?</span>
            <Link href="/login" className="signin">Sign in</Link>
          </div>
        </div>
      </nav>

      <main className="page page-narrow">
        <div className="signin-layout">
          <header className="signin-header">
            <span className="eyebrow">Account recovery</span>
            <h1 className="display">
              {state === "success" ? <>All <span className="serif-italic">set</span>.</> : <>Set a new <span className="serif-italic">password</span>.</>}
            </h1>
          </header>

          <div className="form-card signin-card">
            {state === "checking" && (
              <div className="signin-state state-centered">
                <div className="routing-pulse" aria-hidden><span></span><span></span><span></span></div>
                <h2 className="state-title">Checking your link…</h2>
              </div>
            )}

            {state === "mfa" && (
              <div className="signin-state state-centered">
                <h2 className="state-title">Two-step verification</h2>
                <p className="state-subtitle">
                  This account is protected by an authenticator app. Enter your 6-digit code to continue resetting the password.
                </p>
                <form onSubmit={verifyMfa} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "14px", width: "100%" }}>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    className="input"
                    style={{ maxWidth: "180px", textAlign: "center", fontFamily: "var(--font-mono)", fontSize: "20px", letterSpacing: "0.3em" }}
                    placeholder="123456"
                    autoComplete="one-time-code"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  />
                  {error && <p className="state-fine-print" style={{ color: "var(--danger)" }}>{error}</p>}
                  <button type="submit" className={`btn-submit ${busy ? "loading" : ""}`} disabled={mfaCode.length !== 6 || busy} style={{ maxWidth: "260px" }}>
                    <span className="submit-label">Verify</span>
                    <span className="spinner" aria-hidden></span>
                  </button>
                </form>
              </div>
            )}

            {state === "form" && (
              <div className="signin-state">
                <form onSubmit={handleSubmit} noValidate autoComplete="on">
                  <div className="form-row">
                    <label className="field-label" htmlFor="newPassword">
                      <span>New password</span>
                      <span className="req">Required</span>
                    </label>
                    <div className="field-wrap has-suffix">
                      <input
                        id="newPassword"
                        type={showPassword ? "text" : "password"}
                        className="input"
                        placeholder="At least 8 characters"
                        autoComplete="new-password"
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
                    <div className={`pwd-meter ${password ? "visible" : ""}`} data-strength={strength}>
                      <div className="pwd-bar-track">
                        <span className="pwd-bar-seg"></span>
                        <span className="pwd-bar-seg"></span>
                        <span className="pwd-bar-seg"></span>
                      </div>
                      <div className="pwd-strength-label">
                        Strength: <span className="strength-value">{strengthLabel}</span>
                      </div>
                      <ul className="pwd-criteria">
                        {PWD_RULES.map((r) => (
                          <li key={r.key} className={pwd[r.key] ? "met" : ""}>{r.label}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="form-row">
                    <label className="field-label" htmlFor="confirmPassword">
                      <span>Confirm new password</span>
                      <span className="req">Required</span>
                    </label>
                    <div className="field-wrap">
                      <input
                        id="confirmPassword"
                        type={showPassword ? "text" : "password"}
                        className="input"
                        placeholder="Type it again"
                        autoComplete="new-password"
                        required
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                      />
                    </div>
                    {bothFilled && (
                      <div className={`pwd-match-hint ${matches ? "match" : "mismatch"}`}>
                        <span className="match-text">{matches ? "Passwords match." : "Make sure both passwords match."}</span>
                      </div>
                    )}
                  </div>

                  {error && <p className="state-fine-print" style={{ color: "var(--danger)" }}>{error}</p>}

                  <button type="submit" className={`btn-submit ${busy ? "loading" : ""}`} disabled={!password || !confirm || busy}>
                    <span className="submit-label">Update password</span>
                    <span className="spinner" aria-hidden></span>
                  </button>
                </form>
              </div>
            )}

            {state === "success" && (
              <div className="signin-state state-centered">
                <div className="success-check" aria-hidden>
                  <svg width="36" height="36" viewBox="0 0 36 36" fill="none"><path d="M9 18.5 15.5 25 27 12" stroke="#0E0E0C" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </div>
                <h2 className="state-title">Password updated</h2>
                <p className="state-subtitle">Sign in with your new password. Taking you there…</p>
                <div className="routing-pulse" aria-hidden><span></span><span></span><span></span></div>
              </div>
            )}

            {state === "token-error" && (
              <div className="signin-state state-centered">
                <div className="state-icon-xl danger" aria-hidden>
                  <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
                    <path d="M11.5 18.5a4 4 0 0 1 0-5.65l3-3M18.5 11.5a4 4 0 0 1 0 5.65l-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="m6 6 18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
                <h2 className="state-title">This link didn&apos;t work</h2>
                <p className="state-subtitle">
                  Reset links are valid for 1 hour, and they only open in the browser you requested them from. If you opened this on a different device, request a new link from this one — it takes a minute.
                </p>
                <Link href="/forgot-password" className="state-action-btn">
                  Request a new link
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden><path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </Link>
                <p className="state-fine-print">
                  Or <Link href="/login">return to sign in</Link> if you remembered your password.
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
                  Password recovery is paused while the account is under review. Our support team can walk you through next steps.
                </p>
                <a href="mailto:support@staffva.com" className="state-action-btn">Contact support</a>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
