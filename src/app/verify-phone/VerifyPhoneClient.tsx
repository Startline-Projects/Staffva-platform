"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StaffvaLogo from "@/components/landing/StaffvaLogo";
import Asti, { AstiPointChip } from "@/components/landing/Asti";
import { COUNTRIES, DIAL_CODES } from "@/lib/atlasCountries";
import "@/app/landing.css";
import "@/app/atlas-auth.css";

type PhoneState =
  | "intro"
  | "number"
  | "otp"
  | "success"
  | "lockout"
  | "notactive"
  | "already"
  | "unavailable";

type Channel = "whatsapp" | "sms";

const MAX_WRONG_ATTEMPTS = 3;
const LOCKOUT_SECONDS = 5 * 60;
const RESEND_COOLDOWN = 60;

const PHONE_COUNTRIES = COUNTRIES.filter((c) => DIAL_CODES[c.code]);

function formatClock(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function VerifyPhoneClient({
  enabled,
  verifiedPhone,
  defaultCountry,
}: {
  enabled: boolean;
  verifiedPhone: string | null;
  defaultCountry: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<PhoneState>(
    !enabled ? "unavailable" : verifiedPhone ? "already" : "intro"
  );

  // ── number entry ──
  const [countryCode, setCountryCode] = useState(defaultCountry);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [national, setNational] = useState("");
  const [numberError, setNumberError] = useState("");
  const [sending, setSending] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const numberInputRef = useRef<HTMLInputElement>(null);

  // ── OTP entry ──
  const [otp, setOtp] = useState<string[]>(["", "", "", "", "", ""]);
  const [otpError, setOtpError] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [wrongAttempts, setWrongAttempts] = useState(0);
  const [channel, setChannel] = useState<Channel>("whatsapp");
  // Countdowns are DEADLINES, not tick-counters: browsers throttle
  // setInterval in background tabs, and this flow forces a tab switch (the
  // code arrives on the phone / in WhatsApp Web). Seconds are derived.
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState(0);
  const [lockoutLeft, setLockoutLeft] = useState(0);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const sentPhoneRef = useRef(""); // the E.164 the code actually went to

  const country = PHONE_COUNTRIES.find((c) => c.code === countryCode) || PHONE_COUNTRIES[0];
  const dial = DIAL_CODES[country.code];

  const nationalDigits = national.replace(/\D/g, "").replace(/^0+/, "");
  const e164 = `${dial}${nationalDigits}`;
  const plausible = nationalDigits.length >= 6 && e164.length <= 16; // "+" plus max 15 digits

  const prettyPhone = (p: string) => p; // E.164 as-is — honest, unambiguous

  // ── timers ──
  useEffect(() => {
    if (!cooldownUntil) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setCooldown(left);
      if (left <= 0) setCooldownUntil(0);
    };
    tick();
    const t = setInterval(tick, 500);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [cooldownUntil]);

  useEffect(() => {
    if (state === "lockout") {
      setLockoutLeft(LOCKOUT_SECONDS); // primed before the first tick paints
      setLockoutUntil(Date.now() + LOCKOUT_SECONDS * 1000);
    }
  }, [state]);

  useEffect(() => {
    if (state !== "lockout" || !lockoutUntil) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((lockoutUntil - Date.now()) / 1000));
      setLockoutLeft(left);
      if (left <= 0) {
        // The pending verification is likely dead after 5 minutes — start
        // over from the number instead of an OTP screen that can't pass.
        setLockoutUntil(0);
        setWrongAttempts(0);
        setOtp(["", "", "", "", "", ""]);
        setState("number");
      }
    };
    tick();
    const t = setInterval(tick, 500);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [state, lockoutUntil]);

  useEffect(() => {
    if (state !== "success") return;
    const t = setTimeout(() => {
      router.push("/candidate/dashboard");
      router.refresh();
    }, 2400);
    return () => clearTimeout(t);
  }, [state, router]);

  // Close the country menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (menuOpen) setTimeout(() => searchRef.current?.focus(), 40);
  }, [menuOpen]);

  useEffect(() => {
    if (state === "otp") setTimeout(() => otpRefs.current[0]?.focus(), 80);
    if (state === "number") setTimeout(() => numberInputRef.current?.focus(), 80);
  }, [state]);

  const q = search.trim().toLowerCase();
  const filteredCountries = q
    ? PHONE_COUNTRIES.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.code.toLowerCase().includes(q) ||
          DIAL_CODES[c.code].includes(q.replace(/^\+?/, "+")) ||
          DIAL_CODES[c.code].replace("+", "").startsWith(q.replace("+", ""))
      )
    : PHONE_COUNTRIES;

  // ── actions ──
  async function sendCode(toChannel: Channel, phoneOverride?: string) {
    const phone = phoneOverride ?? e164;
    if (sending) return;
    // Failures must land on the screen the user is actually looking at — a
    // resend that dies into setNumberError while the OTP screen is up would
    // fail in complete silence.
    const fromOtp = state === "otp";
    setSending(true);
    setNumberError("");
    if (fromOtp) setOtpError("");
    try {
      const res = await fetch("/api/phone/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, channel: toChannel }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        // Twilio's 5-checks budget belongs to the VERIFICATION, which a
        // resend to the same number reuses — so the attempts counter only
        // resets when the number actually changes.
        if (sentPhoneRef.current !== phone) setWrongAttempts(0);
        sentPhoneRef.current = phone;
        setChannel(toChannel);
        setOtp(["", "", "", "", "", ""]);
        setOtpError("");
        setCooldownUntil(Date.now() + RESEND_COOLDOWN * 1000);
        setState("otp");
        return;
      }
      if (body.code === "not_on_whatsapp") {
        sentPhoneRef.current = phone;
        setState("notactive");
        return;
      }
      const message =
        typeof body.error === "string" && body.error
          ? body.error
          : "We couldn't send the code right now. Try again in a minute.";
      if (fromOtp) {
        setOtpError(message);
      } else {
        if (state === "notactive") {
          // The SMS fallback also failed — surface it back on the number screen.
          setState("number");
        }
        setNumberError(message);
      }
    } catch {
      const message = "We couldn't reach the server. Check your connection and try again.";
      if (fromOtp) {
        setOtpError(message);
      } else {
        // notactive can't display numberError — land where it shows.
        if (state === "notactive") setState("number");
        setNumberError(message);
      }
    } finally {
      setSending(false);
    }
  }

  async function submitOtp(codeOverride?: string) {
    const code = codeOverride ?? otp.join("");
    if (code.length !== 6 || otpBusy) return;
    setOtpBusy(true);
    setOtpError("");
    try {
      const res = await fetch("/api/phone/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: sentPhoneRef.current, code }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setState("success");
        return;
      }
      if (body.code === "too_many_checks") {
        setState("lockout");
        return;
      }
      if (body.code === "incorrect" || body.code === "expired") {
        // Only a code that is definitively useless gets wiped. A transient
        // failure (server hiccup, rate limit) keeps what the user typed so
        // retrying doesn't mean retyping.
        if (body.code === "incorrect") {
          const attempts = wrongAttempts + 1;
          setWrongAttempts(attempts);
          if (attempts >= MAX_WRONG_ATTEMPTS) {
            setState("lockout");
            return;
          }
          setOtpError(
            channel === "whatsapp"
              ? "Incorrect code. Please check the WhatsApp message and try again."
              : "Incorrect code. Please check the text message and try again."
          );
        } else {
          setOtpError("That code expired. Request a new one.");
        }
        setOtp(["", "", "", "", "", ""]);
        setTimeout(() => otpRefs.current[0]?.focus(), 50);
      } else {
        setOtpError(
          typeof body.error === "string" && body.error
            ? body.error
            : "We couldn't check the code right now. Try again in a minute."
        );
      }
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
    if (e.key === "Backspace" && !otp[i] && i > 0) otpRefs.current[i - 1]?.focus();
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length === 6) {
      e.preventDefault();
      setOtp(text.split(""));
      submitOtp(text);
    }
  }

  const attemptsLeft = MAX_WRONG_ATTEMPTS - wrongAttempts;

  const BACK_ARROW = (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M7.5 2.5 4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
        <div className="signin-layout" style={{ maxWidth: "520px" }}>
          <header className="signin-header">
            <Link href="/candidate/dashboard" className="back-to-dash">
              {BACK_ARROW}
              Back to dashboard
            </Link>
            <span className="pipeline-step-indicator">
              <span>StaffVA Pipeline</span>
              <span className="pipe-sep" aria-hidden></span>
              <span className="step-num">Step 2 of 10</span>
            </span>
            <h1 className="display">
              Verify your <span className="serif-italic">WhatsApp</span>.
            </h1>
            <p className="lead">We&apos;ll send you a quick one-time code to confirm your number.</p>
          </header>

          <div className="form-card signin-card">
            {state === "unavailable" && (
              <div className="signin-state state-centered">
                <div className="wa-brand-icon" aria-hidden>
                  <WhatsAppGlyph />
                </div>
                <h2 className="state-title">Phone verification isn&apos;t open yet</h2>
                <p className="state-subtitle">
                  We&apos;re switching this on shortly. The rest of your application isn&apos;t
                  blocked — keep going, and check back here soon.
                </p>
                <Link href="/candidate/dashboard" className="state-action-btn">
                  Back to dashboard
                </Link>
              </div>
            )}

            {state === "already" && (
              <div className="signin-state state-centered">
                <div className="success-check" aria-hidden>
                  <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
                    <path d="m6 13.5 4.5 4.5L20 8.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <h2 className="state-title">Your number is verified.</h2>
                <p className="state-subtitle">
                  We can reach you at{" "}
                  <span className="phone-display">{prettyPhone(verifiedPhone || "")}</span>.
                </p>
                <Link href="/candidate/dashboard" className="state-action-btn">
                  Back to dashboard
                </Link>
                <p className="state-fine-print">
                  New number?{" "}
                  <button type="button" className="linklike" onClick={() => setState("number")}>
                    Verify a different number
                  </button>
                </p>
              </div>
            )}

            {state === "intro" && (
              <div className="signin-state">
                <div style={{ textAlign: "center" }}>
                  <div className="wa-brand-icon" aria-hidden>
                    <WhatsAppGlyph />
                  </div>
                  <h2 className="state-title">We&apos;ll reach you on WhatsApp</h2>
                  <p className="state-subtitle">
                    WhatsApp is how StaffVA will keep in touch with you as your application
                    moves. It&apos;s fast, reliable, and works everywhere.
                  </p>
                </div>
                <ul className="wa-benefits" aria-label="What WhatsApp is used for">
                  <li>
                    <CheckGlyph />
                    <span>
                      <strong>Job match notifications</strong> — we&apos;ll ping you when a role fits.
                    </span>
                  </li>
                  <li>
                    <CheckGlyph />
                    <span>
                      <strong>Application updates</strong> — no more refreshing your inbox.
                    </span>
                  </li>
                  <li>
                    <CheckGlyph />
                    <span>
                      <strong>Interview scheduling</strong> — clients confirm times where you
                      already are.
                    </span>
                  </li>
                </ul>
                <button type="button" className="btn-submit" onClick={() => setState("number")}>
                  <span className="submit-label">Continue</span>
                </button>
                <div className="wa-install-banner">
                  <strong>Don&apos;t have WhatsApp?</strong> It&apos;s free — or we can text your
                  code by SMS instead.
                  <div className="install-links">
                    <a
                      href="https://www.whatsapp.com/download"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="wa-install-link"
                    >
                      Download WhatsApp
                    </a>
                  </div>
                </div>
              </div>
            )}

            {state === "number" && (
              <div className="signin-state">
                <form
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (plausible && !sending) sendCode("whatsapp");
                  }}
                >
                  <div
                    className={`form-row${numberError ? " is-invalid" : ""}`}
                    data-field="phoneNumber"
                    style={{ marginBottom: "6px" }}
                  >
                    <label className="field-label" htmlFor="phoneNumberInput">
                      <span>Phone number</span>
                      <span className="req">Required</span>
                    </label>
                    <div className="phone-input-row">
                      <div
                        className={`phone-country-wrap${menuOpen ? " open" : ""}`}
                        ref={wrapRef}
                      >
                        <button
                          type="button"
                          className="phone-country-trigger"
                          aria-haspopup="listbox"
                          aria-expanded={menuOpen}
                          onClick={() => setMenuOpen((o) => !o)}
                        >
                          <span className="flag" aria-hidden>
                            {country.flag}
                          </span>
                          <span className="dial-code">{dial}</span>
                        </button>
                        <div className="phone-country-menu" role="listbox" aria-label="Country dialing code">
                          <div className="country-search-wrap">
                            <input
                              type="text"
                              className="country-search"
                              ref={searchRef}
                              placeholder="Search countries or codes…"
                              autoComplete="off"
                              value={search}
                              onChange={(e) => setSearch(e.target.value)}
                            />
                          </div>
                          <div className="country-list" role="presentation">
                            {filteredCountries.map((c) => (
                              <div
                                key={c.code}
                                role="option"
                                aria-selected={c.code === countryCode}
                                className={`country-option${c.code === countryCode ? " selected" : ""}`}
                                onClick={() => {
                                  setCountryCode(c.code);
                                  setMenuOpen(false);
                                  setSearch("");
                                  numberInputRef.current?.focus();
                                }}
                              >
                                <span className="flag" aria-hidden>
                                  {c.flag}
                                </span>
                                <span className="country-name">{c.name}</span>
                                <span className="dial-code">{DIAL_CODES[c.code]}</span>
                              </div>
                            ))}
                            {filteredCountries.length === 0 && (
                              <div className="country-empty">No matches — try the dial code.</div>
                            )}
                          </div>
                        </div>
                      </div>
                      <input
                        id="phoneNumberInput"
                        ref={numberInputRef}
                        type="tel"
                        className="phone-number-input"
                        placeholder="917 123 4567"
                        autoComplete="tel-national"
                        inputMode="numeric"
                        value={national}
                        onChange={(e) => {
                          setNational(e.target.value.replace(/[^\d\s().-]/g, ""));
                          setNumberError("");
                        }}
                        required
                      />
                    </div>
                    <div className="field-hint-inline">
                      We&apos;ll send a 6-digit code via WhatsApp. Make sure this number has
                      WhatsApp active.
                    </div>
                    {numberError && (
                      <div className="field-error-text" role="alert" style={{ display: "block" }}>
                        <span className="err-msg">{numberError}</span>
                      </div>
                    )}
                  </div>
                  <button
                    type="submit"
                    className={`btn-submit${sending ? " loading" : ""}`}
                    disabled={!plausible || sending}
                    style={{ marginTop: "22px" }}
                  >
                    <span className="submit-label">Send code via WhatsApp</span>
                    <span className="spinner" aria-hidden></span>
                  </button>
                </form>
              </div>
            )}

            {state === "otp" && (
              <div className="signin-state wa-otp-wrap">
                <button
                  type="button"
                  className="state-back"
                  disabled={sending}
                  onClick={() => setState("number")}
                >
                  {BACK_ARROW}
                  Change number
                </button>
                <div style={{ textAlign: "center" }}>
                  <h2 className="state-title">Enter your 6-digit code</h2>
                  <p className="wa-otp-hint">
                    We sent {channel === "whatsapp" ? "a WhatsApp message" : "an SMS"} to{" "}
                    <span className="phone-display">{prettyPhone(sentPhoneRef.current)}</span>
                  </p>
                </div>
                <div className="otp-group" onPaste={handleOtpPaste}>
                  {otp.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => {
                        otpRefs.current[i] = el;
                      }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      className="otp-input"
                      aria-label={`Digit ${i + 1}`}
                      autoComplete={i === 0 ? "one-time-code" : "off"}
                      value={digit}
                      onChange={(e) => handleOtpChange(i, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(i, e)}
                      disabled={otpBusy}
                    />
                  ))}
                </div>
                {otpError && (
                  <div className="otp-error-text visible" role="alert">
                    <span>{otpError}</span>
                  </div>
                )}
                {wrongAttempts > 0 && attemptsLeft > 0 && (
                  <div className={`attempts-hint${attemptsLeft === 1 ? " warning" : ""}`}>
                    {attemptsLeft} attempt{attemptsLeft === 1 ? "" : "s"} remaining
                  </div>
                )}
                <div className="wa-otp-actions">
                  <span>Didn&apos;t get it?</span>
                  {cooldown > 0 ? (
                    <span className="resend-cooldown">
                      Resend in <strong>{formatClock(cooldown)}</strong>
                    </span>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={sending}
                        onClick={() => sendCode(channel, sentPhoneRef.current)}
                      >
                        Resend code
                      </button>
                      <span className="dot-sep" aria-hidden></span>
                      <button
                        type="button"
                        disabled={sending}
                        onClick={() =>
                          sendCode(channel === "whatsapp" ? "sms" : "whatsapp", sentPhoneRef.current)
                        }
                      >
                        {channel === "whatsapp" ? "Send by SMS instead" : "Try WhatsApp instead"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {state === "success" && (
              <div className="signin-state state-centered">
                <Asti variant="celebrate" size={96} />
                <h2 className="state-title">Phone verified.</h2>
                <AstiPointChip label="+25 · phone verified" />
                <p className="state-subtitle">
                  Nice work. Taking you back to your <strong>dashboard</strong>…
                </p>
                <div className="routing-pulse" aria-hidden>
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            )}

            {state === "lockout" && (
              <div className="signin-state state-centered">
                <div className="state-icon-xl amber" aria-hidden>
                  <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
                    <rect x="7" y="13" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="2" />
                    <path d="M10 13v-3a5 5 0 0 1 10 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
                <h2 className="state-title">Too many incorrect attempts</h2>
                <p className="state-subtitle">
                  For your security, we&apos;ve temporarily paused code entry. You can try again in
                  a few minutes.
                </p>
                <div className="countdown-display">
                  <span className="countdown-time">{formatClock(lockoutLeft)}</span>
                  <span className="countdown-label">Unlocks in</span>
                </div>
                <a href="mailto:support@staffva.com" className="state-action-btn">
                  Contact support
                </a>
                <p className="state-fine-print">
                  Still having trouble? Our team can help you verify another way.
                </p>
              </div>
            )}

            {state === "notactive" && (
              <div className="signin-state state-centered">
                <div className="wa-notactive-icon" aria-hidden>
                  <WhatsAppGlyph />
                </div>
                <h2 className="state-title">WhatsApp isn&apos;t active on that number</h2>
                <p className="state-subtitle">
                  We tried to reach{" "}
                  <span className="phone-display">{prettyPhone(sentPhoneRef.current)}</span> on
                  WhatsApp, but it didn&apos;t go through. We can text the code instead, or you can
                  try another number.
                </p>
                <button
                  type="button"
                  className="state-action-btn"
                  disabled={sending}
                  onClick={() => sendCode("sms", sentPhoneRef.current)}
                >
                  {sending ? "Sending…" : "Text me the code instead"}
                </button>
                <button
                  type="button"
                  className="state-back"
                  disabled={sending}
                  onClick={() => setState("number")}
                >
                  {BACK_ARROW}
                  Try a different number
                </button>
                <p className="state-fine-print">
                  Need to install it?{" "}
                  <a href="https://www.whatsapp.com/download" target="_blank" rel="noopener noreferrer">
                    Download WhatsApp
                  </a>{" "}
                  on your phone, then come back.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function WhatsAppGlyph() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
      <path
        d="M16 5.5C10.2 5.5 5.5 10.2 5.5 16c0 1.9.5 3.6 1.4 5.2L5.5 26.5l5.5-1.4c1.5.8 3.2 1.3 5 1.3 5.8 0 10.5-4.7 10.5-10.4S21.8 5.5 16 5.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M12.5 11.9c.2-.5.5-.5.8-.5h.6c.2 0 .5 0 .7.5s.8 1.9.8 2c.1.2.1.4 0 .6l-.5.7c-.1.2-.3.4-.1.7.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.7-.1l.9-1c.2-.3.4-.2.7-.1l1.9.9c.3.2.5.3.5.4 0 .3 0 .9-.3 1.5-.3.6-1.6 1.3-2.2 1.3-.6.1-1.2.3-4-.9-3.4-1.4-5.5-4.9-5.7-5.1-.2-.2-1.3-1.8-1.3-3.4 0-1.6.8-2.4 1.1-2.7Z"
        fill="currentColor"
      />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="m3 7.5 2.5 2.5L11 4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
