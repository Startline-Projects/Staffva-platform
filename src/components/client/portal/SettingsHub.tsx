"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Profile {
  full_name: string;
  company_name: string | null;
  headline: string | null;
  bio: string | null;
  website_url: string | null;
  timezone: string | null;
  created_at: string;
}

const LIMITS = { full_name: 120, company_name: 160, headline: 120, bio: 1200, website_url: 300 };

/**
 * Settings: the profile editor plus links to everything else that is real.
 *
 * CUT, with the reason:
 *  - Team & permissions, and the 4x8 role matrix. Owner decision D4 defers
 *    team seats, so this is a locked row that says so rather than a matrix of
 *    checkmarks describing permissions that are not enforced anywhere.
 *  - Integrations (Slack, Google Calendar, QuickBooks, Zapier). None exist.
 *    Atlas also claims "all integrations are read-only by default" on the same
 *    card where Slack PUSHES messages and Calendar ADDS events.
 *  - Billing preferences: statement frequency, statement format, auto-send,
 *    Tax ID "for 1099 generation". We do not generate statements on a
 *    schedule and do not issue 1099s — most people hired here are not US
 *    taxpayers, so the form would be collecting an identifier for a document
 *    that is never produced.
 *  - Privacy toggles and "Request export". No analytics opt-out plumbing and
 *    no export job exist.
 *  - Pause and Close account. There is no paused or closed account state; the
 *    honest version is a sentence telling you to write to us, which is what
 *    actually happens.
 *  - The dirty-count save bar. This form knows exactly which fields changed,
 *    so it says so — or says nothing.
 */
export default function SettingsHub({ email }: { email: string | null }) {
  const [p, setP] = useState<Profile | null>(null);
  const [form, setForm] = useState<Profile | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/client/profile")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        if (!alive) return;
        setP(j.profile);
        setForm(j.profile);
        setState("ready");
      })
      .catch(() => alive && setState("failed"));
    return () => { alive = false; };
  }, []);

  // Which fields actually differ — not a count invented for the save bar.
  const changed: (keyof Profile)[] =
    p && form
      ? (Object.keys(LIMITS) as (keyof Profile)[]).filter(
          (k) => (form[k] ?? "") !== (p[k] ?? "")
        )
      : [];

  async function save() {
    if (!form || busy || changed.length === 0) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/client/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          Object.fromEntries(changed.map((k) => [k, form[k] ?? null]))
        ),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || "We couldn't save that.");
        return;
      }
      setP(form);
      setSaved(true);
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => (f ? { ...f, [k]: e.target.value } : f));

  return (
    <section className="st">
      <div className="st-head">
        <h1 className="st-title">Settings</h1>
        <p className="st-lead">Your details, and everything else about your account.</p>
      </div>

      <div className="st-card">
        <h2 className="st-h2">What candidates see</h2>
        <p className="st-help">
          {/* Precise about the audience. There is no public client page, and
              Atlas's "Lives at atlas.work/c/sarah-patel" would be a URL that
              404s. */}
          These details appear on your offers and messages, and on the profile
          page a candidate can open once you have made them an offer, booked an
          interview or hired them. They are not public, and candidates you have
          not contacted cannot see them.
        </p>

        {state === "loading" && <p className="st-muted">Loading…</p>}

        {state === "failed" && (
          <p className="st-error">
            We couldn&apos;t load your profile, so it isn&apos;t shown here. Reload the page — the
            form is hidden rather than shown empty, because empty boxes would look like a profile
            you had never filled in.
          </p>
        )}

        {state === "ready" && form && (
          <div className="st-form">
            <label className="st-field">
              <span>Your name</span>
              <input value={form.full_name ?? ""} onChange={set("full_name")} maxLength={LIMITS.full_name} />
              <small>Candidates see this on every offer and email from you.</small>
            </label>

            <label className="st-field">
              <span>Company</span>
              <input value={form.company_name ?? ""} onChange={set("company_name")} maxLength={LIMITS.company_name} />
              <small>Self-reported. We don&apos;t verify company names, and we don&apos;t tell candidates we do.</small>
            </label>

            <label className="st-field">
              <span>Headline</span>
              <input
                value={form.headline ?? ""}
                onChange={set("headline")}
                maxLength={LIMITS.headline}
                placeholder="Founder at a 12-person SaaS company"
              />
              <small>{(form.headline ?? "").length} / {LIMITS.headline}</small>
            </label>

            <label className="st-field">
              <span>About</span>
              <textarea
                value={form.bio ?? ""}
                onChange={set("bio")}
                maxLength={LIMITS.bio}
                rows={5}
                placeholder="What your team does, how you like to work, what you're hiring for."
              />
              <small>{(form.bio ?? "").length} / {LIMITS.bio}</small>
            </label>

            <label className="st-field">
              <span>Website</span>
              <input value={form.website_url ?? ""} onChange={set("website_url")} maxLength={LIMITS.website_url} placeholder="yourcompany.com" />
            </label>

            <label className="st-field">
              <span>Time zone</span>
              <input value={form.timezone ?? ""} onChange={set("timezone")} maxLength={64} placeholder="PT (UTC−8)" />
              <small>Helps a candidate judge overlap before they accept.</small>
            </label>

            <div className="st-actions">
              <button className="btn btn-primary" onClick={save} disabled={busy || changed.length === 0}>
                {busy ? "Saving…" : "Save changes"}
              </button>
              {/* The real count, from a real comparison. */}
              {changed.length > 0 && !busy && (
                <span className="st-muted">
                  {changed.length} {changed.length === 1 ? "field" : "fields"} changed
                </span>
              )}
              {saved && changed.length === 0 && <span className="st-ok">Saved.</span>}
            </div>
            {error && <p className="st-error">{error}</p>}
          </div>
        )}
      </div>

      <div className="st-card">
        <h2 className="st-h2">Account</h2>
        <ul className="st-rows">
          <li>
            <span className="st-row-main">
              <strong>Email</strong>
              <small>{email ?? "—"}</small>
            </span>
            <span className="st-muted">Sign-in identity — contact us to change it</span>
          </li>
          <li>
            <span className="st-row-main">
              <strong>Password</strong>
              <small>Change the password you sign in with.</small>
            </span>
            <Link href="/account/change-password" className="btn btn-outline">Change</Link>
          </li>
          <li>
            <span className="st-row-main">
              <strong>Two-step verification</strong>
              <small>An authenticator app, plus backup codes. Enforced at the database, not just the screen.</small>
            </span>
            <Link href="/account/security" className="btn btn-outline">Manage</Link>
          </li>
          <li>
            <span className="st-row-main">
              <strong>Identity &amp; card</strong>
              <small>Required to fund escrow, and for nothing else.</small>
            </span>
            <Link href="/verify" className="btn btn-outline">Verification</Link>
          </li>
          <li>
            <span className="st-row-main">
              <strong>Notifications</strong>
              <small>Which events reach you, and where.</small>
            </span>
            <Link href="/settings/notifications" className="btn btn-outline">Manage</Link>
          </li>
          <li>
            <span className="st-row-main">
              <strong>Billing</strong>
              <small>Payments, escrow and CSV exports.</small>
            </span>
            <Link href="/billing" className="btn btn-outline">Open</Link>
          </li>
        </ul>
      </div>

      <div className="st-card">
        <h2 className="st-h2">Not built yet</h2>
        {/* Named rather than hidden. Someone arriving from another platform
            will look for these, and "we haven't built it" is a better answer
            than a control that does nothing. */}
        <ul className="st-rows">
          <li>
            <span className="st-row-main">
              <strong>Team members and roles</strong>
              <small>One login per company today. Tell us if you need a second — that is what decides when we build it.</small>
            </span>
            <span className="st-soon">Soon</span>
          </li>
          <li>
            <span className="st-row-main">
              <strong>Integrations</strong>
              <small>No Slack, Google Calendar, QuickBooks or Zapier connections exist.</small>
            </span>
            <span className="st-soon">Soon</span>
          </li>
          <li>
            <span className="st-row-main">
              <strong>Closing your account</strong>
              <small>
                There is no self-serve close, and we would rather not pretend otherwise. Email{" "}
                <a href="mailto:support@staffva.com">support@staffva.com</a> and we will handle it —
                active engagements have to be ended first.
              </small>
            </span>
          </li>
        </ul>
      </div>
    </section>
  );
}
