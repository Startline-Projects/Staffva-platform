"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { COUNTRIES } from "@/lib/atlasCountries";
import "@/app/landing.css";
import "@/app/atlas-auth.css";

/** Our real pipeline, told honestly on the left column. */
const AHEAD = [
  "Verify your email & WhatsApp",
  "Verify your ID",
  "Take a proctored English assessment",
  "Complete two AI interviews — behavioral & role-specific",
  "Build your profile & record your intro — then you're live.",
];

const ROLE_CATEGORIES = [
  "Paralegal",
  "Legal Assistant",
  "Bookkeeping/AP",
  "Admin",
  "VA",
  "Cold Caller",
  "Sales",
  "SDR",
  "SEO",
  "Marketing",
  "Scheduling",
  "Customer Support",
  "Medical",
  "E-Commerce",
  "Other",
];

/* ── The prototype's validators, verbatim ── */
function emailValid(v: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
function nameValid(v: string) { return v.trim().length >= 2 && /\s/.test(v.trim()); }
function evaluatePassword(val: string) {
  return {
    length: val.length >= 8,
    upper: /[A-Z]/.test(val),
    lower: /[a-z]/.test(val),
    number: /[0-9]/.test(val),
    special: /[^A-Za-z0-9]/.test(val),
  };
}
function passwordValid(v: string) {
  const r = evaluatePassword(v);
  return r.length && r.upper && r.lower && r.number && r.special;
}

const PWD_RULES: { key: keyof ReturnType<typeof evaluatePassword>; label: string }[] = [
  { key: "length", label: "At least 8 characters" },
  { key: "upper", label: "One uppercase letter" },
  { key: "lower", label: "One lowercase letter" },
  { key: "number", label: "One number" },
  { key: "special", label: "One symbol (e.g. ! @ #)" },
];

type FieldState = "idle" | "valid" | "invalid";

const ERR_ICON = (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" /><path d="M6 3.5v2.5M6 8v.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
);
const VALID_ICON = (
  <span className="validation-icon valid" aria-hidden>
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5.2 4 7.2 8 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
  </span>
);

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; "expired-callback"?: () => void }) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

export default function CandidateSignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [country, setCountry] = useState<string>("");
  const [countryOpen, setCountryOpen] = useState(false);
  const [countryQuery, setCountryQuery] = useState("");
  const [roleCategory, setRoleCategory] = useState("");
  const [referral, setReferral] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreeAge, setAgreeAge] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);

  const [states, setStates] = useState<Record<string, FieldState>>({});
  const [checkErrors, setCheckErrors] = useState<{ terms?: boolean; age?: boolean }>({});
  const [alert, setAlert] = useState<{ title: string; body: React.ReactNode } | null>(null);
  const [loading, setLoading] = useState(false);
  const [showBlocker, setShowBlocker] = useState(false);
  const [successOverlay, setSuccessOverlay] = useState(false);

  const countryWrapRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const captchaRef = useRef<HTMLDivElement>(null);
  const captchaToken = useRef<string | null>(null);
  const captchaWidgetId = useRef<string | null>(null);

  const pwd = evaluatePassword(password);
  const metCount = Object.values(pwd).filter(Boolean).length;
  const strength = metCount >= 5 ? "strong" : metCount >= 3 ? "medium" : "weak";
  const strengthLabel = metCount >= 5 ? "Strong" : metCount >= 3 ? "Medium" : "Weak";

  const selectedCountry = COUNTRIES.find((c) => c.code === country) || null;
  const filteredCountries = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    return q
      ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q)
      : COUNTRIES;
  }, [countryQuery]);

  // The button unlocks once the typed fields are plausible; the checkboxes
  // are enforced by submit so their error copy (and the under-18 blocker)
  // can actually appear — a silently disabled button explains nothing.
  const fieldsComplete =
    nameValid(fullName) && emailValid(email) && passwordValid(password) &&
    !!country && !!roleCategory;

  // Close the country menu on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (countryWrapRef.current && !countryWrapRef.current.contains(e.target as Node)) {
        setCountryOpen(false);
      }
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  // Cloudflare Turnstile — renders only when the site key exists. NOTE: do
  // NOT enable Supabase's captcha enforcement until every auth surface sends
  // a token (login, client signup, password reset — steps 2-4): Supabase
  // enforces captcha project-wide, and enabling it early bricks those flows.
  const turnstileKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  useEffect(() => {
    if (!turnstileKey || !captchaRef.current) return;
    const render = () => {
      if (window.turnstile && captchaRef.current) {
        captchaWidgetId.current = window.turnstile.render(captchaRef.current, {
          sitekey: turnstileKey,
          callback: (token) => { captchaToken.current = token; },
          "expired-callback": () => { captchaToken.current = null; },
        });
      }
    };
    if (window.turnstile) { render(); return; }
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = render;
    document.head.appendChild(s);
  }, [turnstileKey]);

  function setFieldState(name: string, state: FieldState) {
    setStates((prev) => ({ ...prev, [name]: state }));
  }

  function validate(name: string, force = false): boolean {
    switch (name) {
      case "fullName": {
        if (!fullName.trim()) { setFieldState(name, force ? "invalid" : "idle"); return false; }
        const ok = nameValid(fullName);
        setFieldState(name, ok ? "valid" : "invalid");
        return ok;
      }
      case "email": {
        if (!email.trim()) { setFieldState(name, force ? "invalid" : "idle"); return false; }
        const ok = emailValid(email);
        setFieldState(name, ok ? "valid" : "invalid");
        return ok;
      }
      case "password": {
        if (!password) { setFieldState(name, force ? "invalid" : "idle"); return false; }
        const ok = passwordValid(password);
        setFieldState(name, ok ? "valid" : "invalid");
        return ok;
      }
      case "country": {
        const ok = !!country;
        setFieldState(name, ok ? "valid" : "invalid");
        return ok;
      }
      case "role": {
        const ok = !!roleCategory;
        setFieldState(name, ok ? "valid" : "invalid");
        return ok;
      }
    }
    return false;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAlert(null);

    const checks = {
      fullName: validate("fullName", true),
      email: validate("email", true),
      password: validate("password", true),
      country: validate("country"),
      role: validate("role"),
      terms: agreeTerms,
      age: agreeAge,
    };
    setCheckErrors({ terms: !checks.terms, age: !checks.age });

    if (Object.values(checks).some((v) => !v)) {
      if (!checks.age) setShowBlocker(true);
      setTimeout(() => {
        formRef.current?.querySelector(".is-invalid, .invalid")?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
      return;
    }

    // With a captcha configured, wait for a solved token before calling out.
    if (turnstileKey && !captchaToken.current) {
      setAlert({ title: "One more thing.", body: "Please complete the verification challenge below the form." });
      return;
    }

    setLoading(true);
    const supabase = createClient();
    try {

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { role: "candidate", full_name: fullName.trim() },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        ...(captchaToken.current ? { captchaToken: captchaToken.current } : {}),
      },
    });

    if (signUpError) {
      // Turnstile tokens are single-use — the failed attempt consumed this
      // one, so a retry needs a fresh challenge.
      if (turnstileKey && window.turnstile) {
        window.turnstile.reset(captchaWidgetId.current || undefined);
        captchaToken.current = null;
      }
      if (/already|registered|exists/i.test(signUpError.message)) {
        setAlert({
          title: "That email is already registered.",
          body: <>Try <Link href="/login">signing in instead</Link>, or use a different email address.</>,
        });
      } else {
        setAlert({ title: "We couldn't create your account.", body: signUpError.message });
      }
      return;
    }

    // Supabase returns an obfuscated user with no identities for an email
    // that already has an account — surface the same alert instead of a
    // fake success.
    if (signUpData?.user && Array.isArray(signUpData.user.identities) && signUpData.user.identities.length === 0) {
      setAlert({
        title: "That email is already registered.",
        body: <>Try <Link href="/login">signing in instead</Link>, or use a different email address.</>,
      });
      return;
    }

    if (signUpData?.user) {
      const profileRes = await fetch("/api/ensure-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: signUpData.user.id,
          email,
          role: "candidate",
          fullName: fullName.trim(),
          signup: {
            country: selectedCountry?.name || "",
            roleCategory,
            termsAccepted: agreeTerms,
            ageConfirmed: agreeAge,
            marketingOptIn,
            referralCode: referral,
          },
        }),
      });
      // A profile that failed to create is an account that cannot proceed —
      // do not show success over a 500.
      if (!profileRes.ok) {
        setAlert({
          title: "We couldn't finish setting up your account.",
          body: <>Please try again in a moment, or contact <a href="mailto:support@staffva.com">support@staffva.com</a>.</>,
        });
        return;
      }
    }

    // Must verify email before signing in.
    await supabase.auth.signOut();

    // Send the verification email through our outbox. A 429 still reaches
    // the check-your-email screen (the resend button is the recovery path).
    const verifyRes = await fetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    if (!verifyRes.ok && verifyRes.status !== 429) {
      setAlert({
        title: "Your account was created, but the verification email failed.",
        body: <>Please contact <a href="mailto:support@staffva.com">support@staffva.com</a> so we can activate it.</>,
      });
      return;
    }

    setSuccessOverlay(true);
    const sentParam = verifyRes.ok ? "&sent=1" : "";
    setTimeout(() => {
      router.push(`/verify-email?email=${encodeURIComponent(email)}${sentParam}`);
    }, 2400);
    } catch {
      setAlert({
        title: "Something went wrong on our side.",
        body: <>Please try again, or contact <a href="mailto:support@staffva.com">support@staffva.com</a> if it keeps happening.</>,
      });
    } finally {
      setLoading(false);
    }
  }



  const wrapClass = (name: string, extra = "") =>
    `field-wrap ${extra} ${states[name] === "valid" ? "is-valid" : states[name] === "invalid" ? "is-invalid" : ""}`;
  const rowClass = (name: string) =>
    `${states[name] === "invalid" ? "is-invalid" : ""}`;

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

      <main className="page">
        <div className="layout">
            {/* ── Left: context ── */}
            <aside className="context">
              <span className="eyebrow">Join StaffVA · Candidate Application</span>
              <h1 className="display">
                Create your<br />
                <span className="serif-italic underline-accent">candidate</span> account.
              </h1>
              <p className="lead">
                StaffVA is a curated marketplace for vetted global talent. Starting your application takes about <strong>two minutes</strong>. Getting fully approved takes a few days — and every step is on your time.
              </p>

              <div className="ahead-card" aria-label="What's ahead">
                <div className="label">What&apos;s ahead</div>
                <ol className="ahead-list">
                  {AHEAD.map((step) => (<li key={step}>{step}</li>))}
                </ol>
                <div className="ahead-footer">
                  <span>10 steps total</span>
                  <span>~3–7 days</span>
                </div>
              </div>
            </aside>

            {/* ── Right: form ── */}
            <section className="form-col" aria-labelledby="form-title">
              <div className="trust-strip" role="status">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                  <path d="M9 1.5 2.25 4.5v4.125c0 3.75 2.813 7.125 6.75 7.875 3.938-.75 6.75-4.125 6.75-7.875V4.5L9 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  <path d="m6.5 9 1.875 1.875L11.5 7.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>Your application is free. Your data is encrypted. We only use it to verify you and match you with clients.</span>
              </div>

              <div className="form-card">
                <div className="form-card-header">
                  <h2 id="form-title">Tell us about yourself</h2>
                  <span className="step-tag">Step 1 of 10</span>
                </div>

                {alert && (
                  <div className="form-alert visible" role="alert">
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                      <circle cx="9" cy="9" r="7.5" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M9 5.25v4.5M9 12.375v.375" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    <div>
                      <strong>{alert.title}</strong>
                      <span> {alert.body}</span>
                    </div>
                  </div>
                )}

                <form ref={formRef} onSubmit={handleSubmit} noValidate autoComplete="on">
                  {/* Full legal name */}
                  <div className={`form-row ${rowClass("fullName")}`} data-field="fullName">
                    <label className="field-label" htmlFor="fullName">
                      <span>Full legal name</span>
                      <span className="req">Required</span>
                    </label>
                    <div className={wrapClass("fullName")}>
                      <input
                        id="fullName"
                        type="text"
                        className="input"
                        placeholder="e.g. Maria Santos Reyes"
                        autoComplete="name"
                        required
                        value={fullName}
                        onChange={(e) => { setFullName(e.target.value); if (states.fullName === "invalid") setFieldState("fullName", "idle"); }}
                        onBlur={() => validate("fullName")}
                      />
                      {VALID_ICON}
                    </div>
                    <div className="field-hint-inline">Use the exact name on your government ID. You won&apos;t be able to change this later.</div>
                    <div className="field-error-text" role="alert">
                      {ERR_ICON}
                      <span className="err-msg">Please enter your full legal name (first and last).</span>
                    </div>
                  </div>

                  {/* Email */}
                  <div className={`form-row ${rowClass("email")}`} data-field="email">
                    <label className="field-label" htmlFor="email">
                      <span>Email address</span>
                      <span className="req">Required</span>
                    </label>
                    <div className={wrapClass("email")}>
                      <input
                        id="email"
                        type="email"
                        className="input"
                        placeholder="you@example.com"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => { setEmail(e.target.value); if (states.email === "invalid") setFieldState("email", "idle"); }}
                        onBlur={() => validate("email")}
                      />
                      {VALID_ICON}
                    </div>
                    <div className="field-error-text" role="alert">
                      {ERR_ICON}
                      <span className="err-msg">Please enter a valid email address.</span>
                    </div>
                  </div>

                  {/* Password */}
                  <div className={`form-row ${rowClass("password")}`} data-field="password">
                    <label className="field-label" htmlFor="password">
                      <span>Password</span>
                      <span className="req">Required</span>
                    </label>
                    <div className={wrapClass("password", "has-suffix")}>
                      <input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        className="input"
                        placeholder="At least 8 characters"
                        autoComplete="new-password"
                        required
                        value={password}
                        onChange={(e) => { setPassword(e.target.value); if (states.password === "invalid") setFieldState("password", "idle"); }}
                        onBlur={() => validate("password")}
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
                    <div className="field-error-text" role="alert">
                      {ERR_ICON}
                      <span className="err-msg">Password must meet all the criteria below.</span>
                    </div>
                  </div>

                  {/* Country + Role */}
                  <div className="form-row split">
                    <div className={rowClass("country")} data-field="country">
                      <label className="field-label" htmlFor="countryTrigger">
                        <span>Country of residence</span>
                        <span className="req">Required</span>
                      </label>
                      <div className={wrapClass("country")}>
                        <div
                          className={`country-wrap ${countryOpen ? "open" : ""}`}
                          ref={countryWrapRef}
                          onKeyDown={(e) => {
                            if (e.key === "Escape" && countryOpen) {
                              e.stopPropagation();
                              setCountryOpen(false);
                              (document.getElementById("countryTrigger") as HTMLButtonElement | null)?.focus();
                            }
                          }}
                        >
                          <button
                            type="button"
                            className={`country-trigger ${selectedCountry ? "" : "empty"}`}
                            id="countryTrigger"
                            aria-haspopup="listbox"
                            aria-expanded={countryOpen}
                            onClick={() => { setCountryOpen(!countryOpen); setCountryQuery(""); }}
                          >
                            <span className="flag" aria-hidden>{selectedCountry?.flag || "🌍"}</span>
                            <span className="country-name">{selectedCountry?.name || "Select country…"}</span>
                          </button>
                          {countryOpen && (
                            <div className="country-menu" role="listbox" aria-label="Country of residence">
                              <div className="country-search-wrap">
                                <input
                                  type="text"
                                  className="country-search"
                                  placeholder="Search countries…"
                                  autoComplete="off"
                                  autoFocus
                                  value={countryQuery}
                                  onChange={(e) => setCountryQuery(e.target.value)}
                                />
                              </div>
                              <div className="country-list" role="presentation">
                                {filteredCountries.map((c) => (
                                  <button
                                    key={c.code}
                                    type="button"
                                    className={`country-option ${c.code === country ? "selected" : ""}`}
                                    role="option"
                                    aria-selected={c.code === country}
                                    onClick={() => {
                                      setCountry(c.code);
                                      setCountryOpen(false);
                                      setFieldState("country", "valid");
                                    }}
                                  >
                                    <span className="flag" aria-hidden>{c.flag}</span>
                                    <span>{c.name}</span>
                                    <span className="country-code">{c.code}</span>
                                  </button>
                                ))}
                                {filteredCountries.length === 0 && (
                                  <div className="no-results">No countries match &ldquo;{countryQuery}&rdquo;</div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="field-error-text" role="alert">
                        {ERR_ICON}
                        <span className="err-msg">Please select your country.</span>
                      </div>
                    </div>

                    <div className={rowClass("role")} data-field="role">
                      <label className="field-label" htmlFor="roleCategory">
                        <span>Applying for</span>
                        <span className="req">Required</span>
                      </label>
                      <div className={wrapClass("role")}>
                        <select
                          id="roleCategory"
                          className={`select ${roleCategory ? "" : "empty"}`}
                          required
                          value={roleCategory}
                          onChange={(e) => { setRoleCategory(e.target.value); setFieldState("role", e.target.value ? "valid" : "invalid"); }}
                        >
                          <option value="" disabled>Choose role category…</option>
                          {ROLE_CATEGORIES.map((r) => (<option key={r} value={r}>{r}</option>))}
                        </select>
                      </div>
                      <div className="field-error-text" role="alert">
                        {ERR_ICON}
                        <span className="err-msg">Please choose a role category.</span>
                      </div>
                    </div>
                  </div>

                  {/* Referral code */}
                  <div className="form-row" data-field="referral">
                    <label className="field-label" htmlFor="referral">
                      <span>Referral or recruiter code</span>
                      <span className="req">Optional</span>
                    </label>
                    <div className="field-wrap">
                      <input
                        id="referral"
                        type="text"
                        className="input"
                        placeholder="e.g. SVA-REC-XYZ"
                        autoComplete="off"
                        value={referral}
                        onChange={(e) => setReferral(e.target.value)}
                      />
                    </div>
                    <div className="field-hint-inline">If you were referred by a StaffVA recruiter or existing talent, add their code here.</div>
                  </div>

                  {/* Agreements */}
                  <div className="check-stack">
                    <label className={`check-row ${checkErrors.terms ? "invalid" : ""}`} data-field="terms">
                      <input type="checkbox" checked={agreeTerms} onChange={(e) => { setAgreeTerms(e.target.checked); if (e.target.checked) setCheckErrors((p) => ({ ...p, terms: false })); }} required />
                      <span className="check-box" aria-hidden></span>
                      <span>
                        I agree to StaffVA&apos;s <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.
                      </span>
                    </label>
                    {checkErrors.terms && <div className="check-row-error" style={{ display: "block" }}>You need to agree to the Terms &amp; Privacy Policy to create an account.</div>}

                    <label className={`check-row ${checkErrors.age ? "invalid" : ""}`} data-field="age">
                      <input type="checkbox" checked={agreeAge} onChange={(e) => { setAgreeAge(e.target.checked); if (e.target.checked) setCheckErrors((p) => ({ ...p, age: false })); }} required />
                      <span className="check-box" aria-hidden></span>
                      <span>I confirm I am 18 years of age or older.</span>
                    </label>
                    {checkErrors.age && <div className="check-row-error" style={{ display: "block" }}>You must be at least 18 to apply to StaffVA.</div>}

                    <label className="check-row">
                      <input type="checkbox" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} />
                      <span className="check-box" aria-hidden></span>
                      <span>Send me occasional product updates and new opportunities <em style={{ color: "var(--ink-mute)", fontStyle: "normal", fontSize: "12.5px" }}>(optional)</em></span>
                    </label>
                  </div>

                  {turnstileKey && <div ref={captchaRef} style={{ marginTop: "16px" }} />}

                  {/* Submit */}
                  <div className="form-submit-row">
                    <button type="submit" className={`btn-submit ${loading ? "loading" : ""}`} disabled={!fieldsComplete || loading}>
                      <span className="submit-label">Create account</span>
                      <svg className="arrow" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                        <path d="M3.75 9h10.5M9.75 4.5 14.25 9l-4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="spinner" aria-hidden></span>
                    </button>
                    <div className="helper-row">
                      Have an account? <Link href="/login">Sign in instead</Link>
                    </div>
                  </div>
                </form>
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
            </section>
          </div>

      </main>

      {/* ── Success overlay ── */}
      {successOverlay && (
        <div className="success-overlay visible" role="dialog" aria-modal="true" aria-labelledby="successTitle">
          <div className="success-card">
            <div className="success-check" aria-hidden>
              <svg width="36" height="36" viewBox="0 0 36 36" fill="none"><path d="M9 18.5 15.5 25 27 12" stroke="#0E0E0C" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <h2 id="successTitle">Account created.</h2>
            <p>
              We sent a verification link to <strong>{email}</strong>.
              Click it to continue your application.
            </p>
            <div className="success-routing">
              <span className="dot-pulse" aria-hidden></span>
              Taking you to the next step…
            </div>
          </div>
        </div>
      )}

      {/* ── Under-18 blocker ── */}
      {showBlocker && (
        <div className="blocker-overlay visible" role="dialog" aria-modal="true" aria-labelledby="blockerTitle">
          <div className="blocker-card">
            <div className="blocker-icon" aria-hidden>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.5" /><path d="M12 7v6M12 16v.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </div>
            <h3 id="blockerTitle">You need to be 18 or older</h3>
            <p>StaffVA is a workplace platform and we can only accept applicants who are at least 18 years of age. If this was a mistake, please check the box and try again.</p>
            <div className="blocker-actions">
              <button type="button" className="primary" onClick={() => setShowBlocker(false)}>Got it</button>
              <a href="mailto:support@staffva.com" className="ghost" style={{ padding: "10px 18px", display: "inline-flex", alignItems: "center", fontSize: "14px", fontWeight: 500, borderRadius: "999px", textDecoration: "none" }}>Contact support</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
