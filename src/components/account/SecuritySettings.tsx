"use client";

import { useState } from "react";
import Link from "next/link";
import { useTwoFactor } from "@/components/auth/useTwoFactor";

/**
 * Two-step verification (TOTP) — the legacy/portal skin.
 *
 * A COMPONENT, not a page, because three surfaces need it inside three
 * different shells. It used to live only at (main)/account/security, so every
 * portal user who clicked their avatar was dropped out of Atlas into the
 * legacy Navbar — the same break the application flow had.
 *
 * The sequencing all lives in `useTwoFactor`, which the admin panel's Atlas
 * skin shares. Credential ordering is the one thing that must not exist twice:
 * when this file held its own copy it unenrolled BEFORE deleting the backup
 * codes, so a failed delete left live recovery codes against no authenticator
 * — which the next enrollment would then inherit.
 */
export default function SecuritySettings() {
  const tf = useTwoFactor();
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");

  async function confirmEnroll(e: React.FormEvent) {
    e.preventDefault();
    const ok = await tf.verify(code);
    setCode("");
    if (ok) setNotice("Two-step verification is on. You'll be asked for a code at every sign-in.");
  }

  async function turnOff() {
    if (!confirm("Turn off two-step verification? Your account will rely on your password alone.")) return;
    if (await tf.disable()) setNotice("Two-step verification is off. Your backup codes no longer work.");
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-bold text-text">Security</h1>
      <p className="mt-1 text-sm text-text/60">Two-step verification for your StaffVA account.</p>

      {notice && (
        <div className="mt-4 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">{notice}</div>
      )}
      {tf.error && (
        <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{tf.error}</div>
      )}

      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6">
        {tf.state.status === "loading" && <p className="text-sm text-text/50">Loading…</p>}

        {tf.state.status === "signed-out" && (
          <p className="text-sm text-text/70">
            You need to be signed in to manage security settings.{" "}
            <Link href="/login?next=/account/security" className="text-primary underline">Sign in</Link>
          </p>
        )}

        {tf.state.status === "off" && (
          <>
            <h2 className="text-sm font-semibold text-text">Two-step verification is off</h2>
            <p className="mt-2 text-sm text-text/60">
              Add a 6-digit code from an authenticator app (Google Authenticator, 1Password, Authy…) on top of your password. If your password ever leaks, your account stays yours.
            </p>
            <button
              onClick={tf.begin}
              disabled={tf.busy}
              className="mt-4 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-50"
            >
              {tf.busy ? "Setting up…" : "Turn on two-step verification"}
            </button>
          </>
        )}

        {tf.state.status === "enrolling" && (
          <>
            <h2 className="text-sm font-semibold text-text">Scan this QR code</h2>
            <p className="mt-2 text-sm text-text/60">
              Open your authenticator app, scan the code, then enter the 6-digit code it shows to confirm.
            </p>
            <div className="mt-4 flex flex-col items-center gap-3">
              {/* Supabase returns the QR as an SVG data URI */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={tf.state.qr} alt="Authenticator QR code" className="h-44 w-44 rounded-lg border border-gray-200 bg-white p-2" />
              <p className="text-xs text-text/50 break-all text-center">
                Can&apos;t scan? Enter this key manually: <code className="font-mono bg-gray-50 px-1.5 py-0.5 rounded">{tf.state.secret}</code>
              </p>
            </div>
            <form onSubmit={confirmEnroll} className="mt-4 flex items-center justify-center gap-3">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-center font-mono text-lg tracking-widest focus:border-primary focus:outline-none"
              />
              <button
                type="submit"
                disabled={code.length !== 6 || tf.busy}
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-50"
              >
                {tf.busy ? "Checking…" : "Confirm"}
              </button>
            </form>
            <button onClick={tf.cancel} className="mt-3 text-xs text-text/50 underline">
              Cancel
            </button>
          </>
        )}

        {tf.state.status === "on" && (
          <>
            <h2 className="text-sm font-semibold text-text flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              Two-step verification is on
            </h2>
            <p className="mt-2 text-sm text-text/60">
              Every sign-in asks for a 6-digit code from your authenticator app.
            </p>
            <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <h3 className="text-sm font-semibold text-text">Backup codes</h3>
              {tf.codes ? (
                <>
                  <p className="mt-1 text-sm text-text/60">
                    If you lose your authenticator, one of these gets you back
                    in: using it at sign-in removes two-step verification from
                    your account so you can set it up fresh. Each works once,
                    and this is the only time they&apos;re shown — copy them
                    somewhere safe now.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 font-mono text-sm text-text sm:grid-cols-5 sm:gap-x-2">
                    {tf.codes.map((c) => (
                      <span key={c}>{c}</span>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => navigator.clipboard?.writeText(tf.codes!.join("\n")).then(() => setNotice("Backup codes copied."))}
                      className="text-xs font-semibold text-primary underline"
                    >
                      Copy all
                    </button>
                    <button type="button" onClick={tf.dismissCodes} className="text-xs text-text/50 underline">
                      I&apos;ve saved them
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="mt-1 text-sm text-text/60">
                    {tf.state.remaining == null
                      ? "How many codes are unused can only be read during a two-step session, so it isn't shown here. Generating a new set always replaces the old one."
                      : tf.state.remaining > 0
                        ? `${tf.state.remaining} unused code${tf.state.remaining === 1 ? "" : "s"} left. Lost the list? Generating a new set invalidates the old one.`
                        : "If you lose your authenticator, a backup code is the only way back in without support. Generate a set and store it safely."}
                  </p>
                  <button
                    type="button"
                    onClick={tf.mint}
                    disabled={tf.busy}
                    className="mt-3 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-text hover:bg-white transition-colors disabled:opacity-50"
                  >
                    {tf.busy ? "Generating…" : tf.state.remaining ? "Generate a new set" : "Generate backup codes"}
                  </button>
                </>
              )}
            </div>
            <button
              onClick={turnOff}
              disabled={tf.busy}
              className="mt-4 rounded-lg border border-red-300 px-5 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              {tf.busy ? "Working…" : "Turn off"}
            </button>
          </>
        )}
      </div>

      <p className="mt-4 text-xs text-text/40">
        Lost your authenticator? Use one of your backup codes at sign-in
        (&ldquo;Use a backup code instead&rdquo; under the code prompt) — it
        removes two-step from your account so you can re-enroll. No codes
        either? Contact <a href="mailto:support@staffva.com" className="underline">support@staffva.com</a> from your account email.
      </p>
    </div>
  );
}
