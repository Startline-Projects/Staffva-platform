"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * The Atlas notification-settings view, client side.
 *
 * The difference from the candidate version is the Email column. Candidate
 * email is frozen, so that column renders permanently disabled over there.
 * CLIENT EMAIL IS NOT FROZEN — the events below already send mail today —
 * so the column shows the address they actually receive at and states
 * plainly that it is on. It is not a toggle: per-category email opt-outs
 * would need a preference the send sites consult, and shipping a switch that
 * silently changes nothing is exactly the dead control this project keeps
 * removing. When that preference exists, the switch becomes real here.
 *
 * WhatsApp and quiet hours are omitted the way the Refer nav was: a control
 * for a thing that does not exist is a promise.
 *
 * 'contract' and 'payment' are always on — a signature request and money
 * moving are not things a person should be able to switch off by accident.
 * Atlas marks its equivalents "always on — important".
 */

interface Row {
  category: string;
  label: string;
  sub: string;
  locked?: boolean;
  /** Does an email actually send for this category today? */
  email: boolean;
}

interface Section {
  title: string;
  sub: string;
  rows: Row[];
}

const SECTIONS: Section[] = [
  {
    title: "Proposals",
    sub: "How candidates answer what you send.",
    rows: [
      {
        category: "offer",
        // NOT "accepted": an acceptance writes a 'contract' bell, because
        // what happens next is a signature. Review caught this label
        // offering control over an event this switch does not govern.
        label: "Declined or countered",
        sub: "Each round of a negotiation, and a decline. An acceptance rings the Contracts bell below",
        email: true,
      },
    ],
  },
  {
    title: "Messages",
    sub: "Conversations with candidates.",
    rows: [
      {
        category: "message",
        label: "New message",
        sub: "One bell per conversation per day, so an active thread doesn't flood it. There is no email for messages — turning this off means a reply reaches you nowhere until you open your inbox",
        email: false,
      },
    ],
  },
  {
    title: "Interviews",
    sub: "Bookings on your calendar.",
    rows: [
      {
        category: "interview",
        // Not "booked or cancelled": you are the one who books, so no bell
        // is written for that — announcing your own click back to you.
        label: "Interview cancelled",
        sub: "When a candidate calls off an interview you had scheduled",
        email: true,
      },
    ],
  },
  {
    title: "Contracts",
    sub: "Signatures on agreements you issued.",
    rows: [
      {
        category: "contract",
        label: "Contract events",
        sub: "A proposal accepted, and the agreement fully executed once both sides sign (always on — important)",
        locked: true,
        email: true,
      },
    ],
  },
  {
    title: "Payments",
    sub: "Money you are being asked to release.",
    rows: [
      {
        category: "payment",
        label: "Approvals and escrow",
        sub: "A milestone marked complete releases on its own after 7 days unless you approve it first — you are told the day that clock starts (always on — important)",
        locked: true,
        email: true,
      },
    ],
  },
  {
    title: "Engagements",
    sub: "Changes to an active working relationship.",
    rows: [
      {
        category: "engagement",
        label: "Notice, pause, and resume",
        sub: "When a candidate gives notice, or an engagement is paused or resumed",
        email: true,
      },
    ],
  },
];

export default function ClientNotifSettings({
  initialMuted,
  email,
}: {
  initialMuted: string[];
  email: string;
}) {
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
    const { error: rpcErr } = await createClient().rpc("set_client_notification_prefs", {
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
            Pick which events ring the bell. Contract and payment events always
            do — those are the ones with a clock attached.
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
                    {/* Per row, because it is not uniform: five categories
                        really do email, Messages does not. A row that showed
                        a green Email switch over a channel that never sends
                        would be the exact false claim this project keeps
                        removing. Disabled either way — no per-category email
                        preference exists for the send sites to read yet, and
                        a switch that changed nothing is worse than none. */}
                    <button
                      type="button"
                      className={`notif-toggle-switch${row.email ? " on" : ""}`}
                      aria-pressed={row.email}
                      aria-disabled="true"
                      aria-label={`${row.label} — email${row.email ? " (on)" : " (none for this category)"}`}
                      disabled
                      title={row.email ? "Email is on for this category" : "No email is sent for this category"}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        <p style={{ marginTop: 18, fontSize: 12.5, color: "var(--ink-mute)" }}>
          Email goes to <strong>{email}</strong>, for the categories marked
          above — messages are bell-only. Turning a category off stops the
          bell for new events of that kind; nothing is queued for later, so
          for messages that means no notification at all.
        </p>
      </div>
    </section>
  );
}
