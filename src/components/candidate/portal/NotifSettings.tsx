"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * The Atlas notification-settings view, cut to the channels that exist here.
 *
 * Atlas shows three channel columns (In-app / Email / WhatsApp) and a
 * quiet-hours card. On this platform: candidate email is frozen by owner
 * decision ("no candidate emails until I have tested everything"), WhatsApp
 * has no backend at all, and quiet hours would gate those missing channels.
 * So: In-app toggles are REAL (they write muted_notification_categories, and
 * a DB trigger drops muted inserts no matter which code path writes); the
 * Email column renders disabled with honest copy; WhatsApp and quiet hours
 * are omitted the way the Refer nav was — a control for a thing that doesn't
 * exist is a promise.
 *
 * 'contract', 'payout', 'profile', and 'interview' are always on. The first
 * two because money and signatures depend on them; 'profile' because the
 * photo-rejection notification row IS the storage of the reviewer's note —
 * a muted insert would erase the reason from existence, not just skip a
 * bell; 'interview' because a cancelled booking reaches the candidate
 * through nothing else. Atlas itself marks its equivalents "always on —
 * important". 'review' and 'system' rows render only once they have real
 * senders (a toggle for events that never fire is furniture).
 */

interface Row {
  category: string;
  label: string;
  sub: string;
  locked?: boolean;
}

interface Section {
  title: string;
  sub: string;
  rows: Row[];
}

const SECTIONS: Section[] = [
  {
    title: "Offers & matching",
    sub: "A client sends you an offer, counters your terms, or invites you to a role.",
    rows: [
      {
        category: "offer",
        label: "Offers, counters, and role invites",
        sub: "Every offer event — new, countered, declined — and shortlist invites",
      },
    ],
  },
  {
    title: "Messages",
    sub: "Clients and your StaffVA specialist.",
    rows: [
      {
        category: "message",
        label: "New message",
        sub: "One bell per client conversation per day, plus your specialist's messages",
      },
    ],
  },
  {
    title: "Interviews",
    sub: "Bookings on your calendar.",
    rows: [
      {
        category: "interview",
        label: "Interview booked or cancelled",
        sub: "When a client books time with you, or calls it off — the bell is the only place a cancellation reaches you (always on)",
        locked: true,
      },
    ],
  },
  {
    title: "Contracts",
    sub: "Signature requests, execution, notice, and pause events.",
    rows: [
      {
        category: "contract",
        label: "Contract events",
        sub: "Ready for signature, fully executed, notice given, paused or resumed (always on — important)",
        locked: true,
      },
    ],
  },
  {
    title: "Payments",
    sub: "Money moving toward you.",
    rows: [
      {
        category: "payout",
        label: "Payout sent or blocked",
        sub: "A payment is on its way — or waiting on your payout setup (always on — important)",
        locked: true,
      },
    ],
  },
  {
    title: "Profile",
    sub: "Reviews of what clients see.",
    rows: [
      {
        category: "profile",
        label: "Profile and photo review results",
        sub: "Approval, and the reviewer's note when something needs a change — this notification is also the record of that note (always on)",
        locked: true,
      },
    ],
  },
];

export default function NotifSettings({ initialMuted }: { initialMuted: string[] }) {
  const [muted, setMuted] = useState<Set<string>>(new Set(initialMuted));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggle(category: string) {
    if (busy) return;
    const next = new Set(muted);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    const prev = muted;
    setMuted(next); // optimistic — the switch must feel like a switch
    setBusy(true);
    setError(null);
    const { error: rpcErr } = await createClient().rpc("set_notification_prefs", {
      p_muted: Array.from(next),
    });
    setBusy(false);
    if (rpcErr) {
      setMuted(prev); // revert: the UI never claims a preference that didn't save
      setError("That didn't save. Check your connection and try again.");
    }
  }

  return (
    <section className="live-notif-settings-view">
      <div className="notif-settings-shell">
        <header className="notif-settings-header">
          <p className="notif-settings-header-eyebrow">Account settings · Notifications</p>
          <h1>
            When to <em>notify you</em>.
          </h1>
          <p className="notif-settings-header-sub">
            Pick which events ring the bell. Contract, payment, interview, and
            review-result events always do — they&apos;re the ones the bell is
            the only messenger for.
          </p>
        </header>

        {error && (
          <p role="alert" style={{ margin: "0 0 14px", fontSize: 13, color: "var(--danger, #C2412B)" }}>
            {error}
          </p>
        )}

        <div className="notif-channels-header">
          <span />
          <span className="notif-channels-header-label">In-app</span>
          <span className="notif-channels-header-label">Email</span>
        </div>

        {SECTIONS.map((sec) => (
          <div className="notif-settings-section" key={sec.title}>
            <div className="notif-settings-section-header">
              <h2>{sec.title}</h2>
              <p>{sec.sub}</p>
            </div>
            {sec.rows.map((row) => {
              const on = !muted.has(row.category);
              return (
                <div className="notif-settings-row" key={row.category}>
                  <div className="notif-settings-row-info">
                    <div className="notif-settings-row-label">{row.label}</div>
                    <div className="notif-settings-row-sub">{row.sub}</div>
                  </div>
                  <div className="notif-channel-toggle">
                    <button
                      type="button"
                      className={`notif-toggle-switch${on ? " on" : ""}`}
                      aria-pressed={on}
                      aria-label={`${row.label} — in-app`}
                      disabled={row.locked}
                      title={row.locked ? "Always on — important" : undefined}
                      onClick={row.locked ? undefined : () => toggle(row.category)}
                    />
                  </div>
                  <div className="notif-channel-toggle">
                    {/* Honest, not decorative: candidate email is off
                        platform-wide while the owner tests. */}
                    <button
                      type="button"
                      className="notif-toggle-switch"
                      aria-pressed={false}
                      aria-disabled="true"
                      disabled
                      title="Email to candidates is paused while StaffVA is in testing"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        <p style={{ marginTop: 18, fontSize: 12.5, color: "var(--ink-mute)" }}>
          Email notifications to candidates are paused while StaffVA is in
          testing — everything above lands in-app. (Sign-in emails like
          password resets still arrive.) Muting a category hides new events
          from your bell entirely; nothing is queued for later.
        </p>
      </div>
    </section>
  );
}
