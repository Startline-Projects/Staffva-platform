"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Two-step verification (TOTP), as rules rather than markup.
 *
 * Four surfaces need this — the legacy account page, the candidate portal,
 * the client portal and now the admin panel — and they are in three
 * different design systems. What must NOT fork across them is the sequence:
 * these are credential operations where the ordering IS the correctness, and
 * a second copy is a second place for that ordering to rot. Skins render;
 * this decides.
 *
 * The three orderings that are load-bearing:
 *
 *  1. Stale unverified factors are cleared BEFORE enrolling. GoTrue refuses a
 *     duplicate friendly name, so an abandoned attempt otherwise locks the
 *     account out of enrolling with an error that explains nothing.
 *  2. Codes are minted AFTER verification, never before — the mint endpoint
 *     demands aal2 precisely so nobody holds recovery credentials for a
 *     factor they never finished setting up.
 *  3. Codes are deleted BEFORE unenrolling. They are credentials against the
 *     enrollment that minted them, and `/api/auth/recover-mfa` accepts any
 *     unused row for the user — so a set that outlives its factor silently
 *     backs the NEXT one. Deleting first means the bad failure mode is a
 *     factor with no codes, which this screen can fix and the user can see.
 */

export type TwoFactorState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "off" }
  | { status: "enrolling"; qr: string; secret: string }
  /** `remaining` is null when it could not be read — not zero. */
  | { status: "on"; remaining: number | null };

export interface TwoFactor {
  state: TwoFactorState;
  busy: boolean;
  error: string | null;
  /**
   * Plaintext backup codes. Non-null only between a mint and the caller
   * dismissing them; nothing persists them, and only hashes reach the server.
   */
  codes: string[] | null;
  begin: () => Promise<void>;
  /** Returns true when the code was accepted. */
  verify: (code: string) => Promise<boolean>;
  mint: () => Promise<boolean>;
  disable: () => Promise<boolean>;
  cancel: () => void;
  dismissCodes: () => void;
  setError: (message: string | null) => void;
}

export function useTwoFactor(options?: { onChange?: () => void }): TwoFactor {
  const [state, setState] = useState<TwoFactorState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const factorRef = useRef<string | null>(null);

  // Read through a ref so a caller passing an inline arrow doesn't re-run
  // every effect below on each of its renders.
  const onChangeRef = useRef(options?.onChange);
  onChangeRef.current = options?.onChange;

  const reload = useCallback(async () => {
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setState({ status: "signed-out" });
      return;
    }
    const { data: factors, error: listErr } = await supabase.auth.mfa.listFactors();
    if (listErr) {
      setError("Your security settings could not be read, so this may be out of date.");
      return;
    }
    // auth-js puts a factor in `totp` only once it is verified; the strays
    // from abandoned attempts live in `all`. Both facts are used here.
    const verified = factors?.totp?.[0];
    if (!verified) {
      factorRef.current = null;
      setState({ status: "off" });
      return;
    }
    factorRef.current = verified.id;
    setState({ status: "on", remaining: await readRemaining() });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  /** Only an aal2 session may count; at aal1 the number is unknown, not zero. */
  async function readRemaining(): Promise<number | null> {
    try {
      const res = await fetch("/api/auth/backup-codes");
      if (!res.ok) return null;
      const body = await res.json();
      return typeof body.remaining === "number" ? body.remaining : null;
    } catch {
      return null;
    }
  }

  /**
   * POST the mint, retrying a 403 once.
   *
   * The route requires aal2, which the browser proves with the session cookie
   * `verify()` has just rewritten. A 403 in the moment after a successful
   * verify is that cookie not having landed, not a refusal — and reporting it
   * as one sends someone away from a screen that was about to work.
   */
  async function postMint(): Promise<string[] | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch("/api/auth/backup-codes", { method: "POST" });
      if (res.ok) {
        const { codes: fresh } = await res.json();
        return Array.isArray(fresh) ? fresh : null;
      }
      if (res.status !== 403) return null;
      await new Promise((r) => setTimeout(r, 600));
    }
    return null;
  }

  const begin = useCallback(async () => {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    try {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      for (const f of factors?.all ?? []) {
        if (f.factor_type === "totp" && f.status !== "verified") {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
      }

      const { data, error: err } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Authenticator app",
      });
      if (err || !data) {
        setError(err?.message ?? "Setup could not be started. Try again.");
        return;
      }
      factorRef.current = data.id;
      setCodes(null);
      setState({ status: "enrolling", qr: data.totp.qr_code, secret: data.totp.secret });
    } catch {
      setError("The server could not be reached.");
    } finally {
      setBusy(false);
    }
  }, []);

  const verify = useCallback(async (code: string): Promise<boolean> => {
    const factorId = factorRef.current;
    if (!factorId || code.length !== 6) return false;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    try {
      const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
      if (chErr || !challenge) {
        setError(chErr?.status === 429
          ? "Too many attempts — wait a minute, then try again."
          : "The check could not be started. Give it a moment and try again.");
        return false;
      }
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code,
      });
      if (vErr) {
        setError(vErr.status === 429
          ? "Too many attempts — wait a minute, then try again."
          : "That code was not accepted. Codes change every 30 seconds — try the one showing now.");
        return false;
      }

      // Two-step is ON from here, whatever happens to the codes.
      const fresh = await postMint();
      if (!fresh) {
        setState({ status: "on", remaining: null });
        // Do not imply the enrollment failed. It did not.
        setError("Two-step is on, but the backup codes could not be created. Generate a set before you sign out — without one, a lost phone means a lost account.");
        onChangeRef.current?.();
        return true;
      }
      setCodes(fresh);
      setState({ status: "on", remaining: fresh.length });
      onChangeRef.current?.();
      return true;
    } catch {
      setError("The server could not be reached.");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const mint = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const fresh = await postMint();
      if (!fresh) {
        setError("New codes could not be created. Any codes you already have are unchanged.");
        return false;
      }
      setCodes(fresh);
      setState((s) => (s.status === "on" ? { status: "on", remaining: fresh.length } : s));
      return true;
    } catch {
      setError("The server could not be reached.");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async (): Promise<boolean> => {
    const factorId = factorRef.current;
    if (!factorId) return false;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    try {
      // Codes first — see ordering note 3 at the top of this file.
      const delRes = await fetch("/api/auth/backup-codes", { method: "DELETE" }).catch(() => null);
      if (!delRes?.ok) {
        setError("Your backup codes could not be removed, so two-step has been left on. Turning it off while they exist would leave live recovery codes against no authenticator. Try again.");
        return false;
      }
      const { error: err } = await supabase.auth.mfa.unenroll({ factorId });
      if (err) {
        setError("Your backup codes were removed but two-step is still on. Generate a new set before you sign out.");
        setState({ status: "on", remaining: 0 });
        return false;
      }
      factorRef.current = null;
      setCodes(null);
      setState({ status: "off" });
      onChangeRef.current?.();
      return true;
    } catch {
      setError("The server could not be reached.");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const cancel = useCallback(() => {
    setError(null);
    setState((s) => (s.status === "enrolling" ? { status: "off" } : s));
  }, []);

  const dismissCodes = useCallback(() => setCodes(null), []);

  return { state, busy, error, codes, begin, verify, mint, disable, cancel, dismissCodes, setError };
}
