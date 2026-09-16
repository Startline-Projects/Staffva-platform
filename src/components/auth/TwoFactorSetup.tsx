"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTwoFactor } from "./useTwoFactor";

/**
 * Two-step verification, in Atlas — the admin panel's skin over
 * `useTwoFactor`. Every rule it follows lives in that hook; nothing here
 * decides anything about credentials, it only draws.
 *
 * The admin panel was the last of the four surfaces without this. The server
 * half has been complete for a while — `/api/auth/backup-codes` mints for an
 * aal2 session, `/api/auth/recover-mfa` takes a code at aal1 because being
 * locked out is its whole point, and the login page has always known how to
 * run the challenge — but with no way in here, all twelve staff accounts
 * signed in on a password alone.
 */
export default function TwoFactorSetup() {
  const router = useRouter();
  // The page around this is server-rendered: its hero reads mfaFactors from
  // the session at request time. Without the refresh it would still say
  // "Two-factor: Off" directly above a panel saying it is on.
  const tf = useTwoFactor({ onChange: () => router.refresh() });
  const [otp, setOtp] = useState("");
  const [copied, setCopied] = useState(false);
  const otpRef = useRef<HTMLInputElement>(null);

  const enrolling = tf.state.status === "enrolling";
  useEffect(() => {
    if (enrolling) otpRef.current?.focus();
  }, [enrolling]);

  async function submit() {
    if (await tf.verify(otp)) setCopied(false);
    setOtp("");
  }

  function copy(codes: string[]) {
    navigator.clipboard?.writeText(codes.join("\n")).then(
      () => setCopied(true),
      () => tf.setError("Copying failed — select the codes and copy them by hand."),
    );
  }

  return (
    <div className="rec-panel">
      <div className="rec-panel-label">Two-step verification</div>

      {tf.error && (
        <p className="rec-note-line" style={{ color: "var(--danger)", marginBottom: 12 }} role="alert">
          {tf.error}
        </p>
      )}

      {tf.state.status === "loading" && <div className="adm-skeleton" style={{ height: 52 }} />}

      {tf.state.status === "signed-out" && (
        <p className="rec-prose">Your session ended. Reload the page and sign in again.</p>
      )}

      {/* ── off ───────────────────────────────────────────────────────── */}
      {tf.state.status === "off" && (
        <>
          <p className="rec-prose" style={{ marginBottom: 14 }}>
            Sign-in asks for your password and a six-digit code from an authenticator app.
            This panel approves candidates, bans accounts and reads every client&apos;s
            spend; right now a password is the only thing in front of all of it.
          </p>
          <button type="button" className="adm-btn primary" disabled={tf.busy} onClick={tf.begin}>
            {tf.busy ? "Starting…" : "Turn on two-step"}
          </button>
        </>
      )}

      {/* ── enrolling ─────────────────────────────────────────────────── */}
      {tf.state.status === "enrolling" && (
        <>
          <p className="rec-prose" style={{ marginBottom: 14 }}>
            Scan this with an authenticator app — 1Password, Authy, Google Authenticator,
            whichever you already use — then type the six digits it shows.
          </p>

          <div className="tfa-enrol">
            <div className="tfa-qr">
              {/* A data: URI from GoTrue, not a remote image — next/image would
                  route it through the optimizer for nothing. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={tf.state.qr} alt="QR code for two-step verification setup" width={168} height={168} />
            </div>
            <div className="tfa-manual">
              <div className="rec-k">Or type this key in by hand</div>
              <code className="tfa-secret">{tf.state.secret}</code>
              <p className="rec-note-line" style={{ marginTop: 10 }}>
                Nothing is switched on until a code is accepted below, so closing this now
                leaves your account exactly as it was.
              </p>
            </div>
          </div>

          <label className="adm-field-label" htmlFor="tfa-otp" style={{ marginTop: 18 }}>
            Six-digit code
          </label>
          <div className="tfa-verify">
            <input
              id="tfa-otp"
              ref={otpRef}
              className="adm-input tfa-otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
            />
            <button type="button" className="adm-btn primary" disabled={tf.busy || otp.length !== 6} onClick={submit}>
              {tf.busy ? "Checking…" : "Confirm"}
            </button>
            <button type="button" className="adm-btn" disabled={tf.busy} onClick={tf.cancel}>
              Cancel
            </button>
          </div>
        </>
      )}

      {/* ── on, with fresh codes on screen ────────────────────────────── */}
      {tf.state.status === "on" && tf.codes && (
        <>
          <p className="rec-prose" style={{ marginBottom: 12 }}>
            <strong>Two-step is on.</strong> Save these recovery codes somewhere that is not
            your phone. Each works once, and this is the only time they are shown — only
            their hashes are stored, so nobody here can read them back to you.
          </p>
          <ul className="tfa-codes">
            {tf.codes.map((c) => <li key={c}><code>{c}</code></li>)}
          </ul>
          <div className="rec-actionbar" style={{ marginTop: 14 }}>
            <button type="button" className="adm-btn" onClick={() => copy(tf.codes!)}>
              {copied ? "Copied" : "Copy all"}
            </button>
            <button type="button" className="adm-btn primary" onClick={tf.dismissCodes}>
              I&apos;ve saved them
            </button>
          </div>
        </>
      )}

      {/* ── on ────────────────────────────────────────────────────────── */}
      {tf.state.status === "on" && !tf.codes && (
        <>
          <p className="rec-prose" style={{ marginBottom: 12 }}>
            <strong>Two-step is on.</strong> Sign-in asks for a code from your authenticator
            app.{" "}
            {tf.state.remaining === null
              ? "Backup codes can only be counted from a two-step session, so this one cannot see how many are left."
              : tf.state.remaining === 0
                ? "No backup codes are left. Generate a set — without one, a lost phone means an account only support can reopen."
                : `${tf.state.remaining} of 10 backup codes are still unused.`}
          </p>
          <div className="rec-actionbar">
            <button type="button" className="adm-btn" disabled={tf.busy} onClick={tf.mint}>
              {tf.busy ? "Working…" : "New backup codes"}
            </button>
            <button
              type="button"
              className="adm-btn danger"
              disabled={tf.busy}
              onClick={() => {
                if (window.confirm("Turn two-step off? Sign-in will need a password alone, and your backup codes stop working.")) {
                  void tf.disable();
                }
              }}
            >
              Turn off
            </button>
          </div>
          <p className="rec-note-line" style={{ marginTop: 10 }}>
            A new set replaces the old one — anything already written down stops working.
            Lost the authenticator itself? Use a backup code at sign-in: it removes two-step
            from the account so you can set it up again, rather than letting you straight in.
          </p>
        </>
      )}
    </div>
  );
}
