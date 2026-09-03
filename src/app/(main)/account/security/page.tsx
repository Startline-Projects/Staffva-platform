"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Phase = "loading" | "signed-out" | "off" | "enrolling" | "on";

/**
 * Two-step verification (TOTP) — enrollment and removal, on Supabase's
 * native MFA. Once a factor is verified here, sign-in shows the Atlas
 * two-step screen and requires the 6-digit code.
 */
export default function SecuritySettingsPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrSvg, setQrSvg] = useState<string>("");
  const [secret, setSecret] = useState<string>("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) { setPhase("signed-out"); return; }
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const verified = factors?.totp?.find((f) => f.status === "verified");
    if (verified) {
      setFactorId(verified.id);
      setPhase("on");
    } else {
      setPhase("off");
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function startEnroll() {
    setBusy(true);
    setError("");
    const supabase = createClient();
    try {
      // A stale unverified factor from an abandoned attempt blocks re-enroll
      // (duplicate friendly name). listFactors' per-type totp array only holds
      // VERIFIED factors — the strays live in .all.
      const { data: factors } = await supabase.auth.mfa.listFactors();
      for (const f of factors?.all ?? []) {
        if (f.factor_type === "totp" && f.status !== "verified") {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
      }
      const { data, error: enrollErr } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator app" });
      if (enrollErr || !data) {
        setError(enrollErr?.message || "Could not start enrollment.");
        return;
      }
      setFactorId(data.id);
      setQrSvg(data.totp.qr_code);
      setSecret(data.totp.secret);
      setCode("");
      setPhase("enrolling");
    } catch {
      setError("Could not start enrollment. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnroll(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6 || busy || !factorId) return;
    setBusy(true);
    setError("");
    const supabase = createClient();
    try {
      const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
      if (chErr || !challenge) { setError("Could not verify. Try again."); return; }
      const { error: vErr } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
      if (vErr) {
        setError("That code didn't match. Check your authenticator app and try again.");
        setCode("");
        return;
      }
      setNotice("Two-step verification is on. You'll be asked for a code at every sign-in.");
      await refresh();
    } catch {
      setError("Could not verify. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!factorId || busy) return;
    if (!confirm("Turn off two-step verification? Your account will rely on your password alone.")) return;
    setBusy(true);
    setError("");
    const supabase = createClient();
    try {
      const { error: unErr } = await supabase.auth.mfa.unenroll({ factorId });
      if (unErr) { setError(unErr.message); return; }
      setNotice("Two-step verification is off.");
      await refresh();
    } catch {
      setError("Could not turn it off. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-bold text-text">Security</h1>
      <p className="mt-1 text-sm text-text/60">Two-step verification for your StaffVA account.</p>

      {notice && (
        <div className="mt-4 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">{notice}</div>
      )}
      {error && (
        <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6">
        {phase === "loading" && <p className="text-sm text-text/50">Loading…</p>}

        {phase === "signed-out" && (
          <p className="text-sm text-text/70">
            You need to be signed in to manage security settings.{" "}
            <Link href="/login?next=/account/security" className="text-primary underline">Sign in</Link>
          </p>
        )}

        {phase === "off" && (
          <>
            <h2 className="text-sm font-semibold text-text">Two-step verification is off</h2>
            <p className="mt-2 text-sm text-text/60">
              Add a 6-digit code from an authenticator app (Google Authenticator, 1Password, Authy…) on top of your password. If your password ever leaks, your account stays yours.
            </p>
            <button
              onClick={startEnroll}
              disabled={busy}
              className="mt-4 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-50"
            >
              {busy ? "Setting up…" : "Turn on two-step verification"}
            </button>
          </>
        )}

        {phase === "enrolling" && (
          <>
            <h2 className="text-sm font-semibold text-text">Scan this QR code</h2>
            <p className="mt-2 text-sm text-text/60">
              Open your authenticator app, scan the code, then enter the 6-digit code it shows to confirm.
            </p>
            <div className="mt-4 flex flex-col items-center gap-3">
              {/* Supabase returns the QR as an SVG data URI */}
              {qrSvg && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrSvg} alt="Authenticator QR code" className="h-44 w-44 rounded-lg border border-gray-200 bg-white p-2" />
              )}
              <p className="text-xs text-text/50 break-all text-center">
                Can&apos;t scan? Enter this key manually: <code className="font-mono bg-gray-50 px-1.5 py-0.5 rounded">{secret}</code>
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
                disabled={code.length !== 6 || busy}
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-50"
              >
                {busy ? "Checking…" : "Confirm"}
              </button>
            </form>
            <button onClick={() => { setPhase("off"); setError(""); }} className="mt-3 text-xs text-text/50 underline">
              Cancel
            </button>
          </>
        )}

        {phase === "on" && (
          <>
            <h2 className="text-sm font-semibold text-text flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              Two-step verification is on
            </h2>
            <p className="mt-2 text-sm text-text/60">
              Every sign-in asks for a 6-digit code from your authenticator app.
            </p>
            <button
              onClick={disable}
              disabled={busy}
              className="mt-4 rounded-lg border border-red-300 px-5 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              {busy ? "Working…" : "Turn off"}
            </button>
          </>
        )}
      </div>

      <p className="mt-4 text-xs text-text/40">
        Lost your authenticator? Contact <a href="mailto:support@staffva.com" className="underline">support@staffva.com</a> from your account email and we&apos;ll help you recover access.
      </p>
    </div>
  );
}
