"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Bucket = "upcoming" | "past" | "cancelled";

interface Interview {
  id: string;
  startsAt: string;
  durationMinutes: number;
  status: string;
  bucket: Bucket;
  outcome: "took_place" | "no_show" | "time_passed" | null;
  anyoneJoined: boolean;
  cancelledAt: string | null;
  cancelledBy: "client" | "candidate" | null;
  cancelReason: string | null;
  rescheduledFrom: string | null;
  wasMoved: boolean;
  hasRoom: boolean;
  candidate: {
    id: string;
    withdrawn: string | null;
    displayName: string;
    country: string | null;
    roleCategory: string | null;
    photo: string | null;
  } | null;
}



const TABS: { key: Bucket; label: string }[] = [
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
  { key: "cancelled", label: "Cancelled" },
];

/** Full local date and time — a timestamptz belongs in the viewer's own zone. */
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/**
 * The join window, matching JOIN_EARLY_MS and OVERRUN_MS in src/lib/daily.ts.
 * These must not drift: the room really is reachable from 15 minutes before
 * until 45 minutes after the scheduled end, and the first draft used a 10/0
 * window that hid "Join call" for the first five minutes and then took it
 * away while the call was still running.
 */
const JOIN_EARLY_MS = 15 * 60_000;
const OVERRUN_MS = 45 * 60_000;

/** "in 11 min" / "in 3 hrs" / "in 2 days" — from a real clock, not a string. */
function untilLabel(mins: number): string {
  if (mins < 1) return "now";
  if (mins < 60) return `in ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs} ${hrs === 1 ? "hour" : "hours"}`;
  const days = Math.round(hrs / 24);
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * The interviews page body.
 *
 * Atlas features NOT built, and the honest reason for each:
 *  - Star ratings, review counts and a "verified" stamp. These ARE backed —
 *    reviews carries published ratings and /candidate/[id] already averages
 *    them, and id_verification_status is a real column this API even selects.
 *    They are left off because this screen answers "when am I speaking to
 *    whom", and the profile is one click away. Not for want of data.
 *  - An interview TYPE taxonomy ("Initial"/"Final") and a written agenda —
 *    no such columns.
 *  - "Completed · 47 min". duration_minutes is the PLANNED length, fixed at 30
 *    by a CHECK constraint; nothing records how long a call actually ran.
 *  - Client notes on past interviews.
 *  - An "Awaiting confirmation" state with proposed time windows. A booking is
 *    confirmed the moment it is made here, so a pending pill would describe a
 *    state that cannot occur.
 *
 * What IS here that Atlas only draws: Reschedule actually reschedules, and the
 * countdown is computed from the clock rather than being the literal string
 * "11 min" in three places.
 */
export default function InterviewsView() {
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Bucket>("upcoming");
  const [busy, setBusy] = useState<string | null>(null);
  const [cardError, setCardError] = useState<{ id: string; message: string } | null>(null);
  const [truncated, setTruncated] = useState(false);
  // The reschedule flow: which booking, and the slots its candidate has open.
  const [moving, setMoving] = useState<string | null>(null);
  // Keyed by booking id: one shared list let a slow response for card A
  // render under card B, showing another candidate's open times.
  const [slots, setSlots] = useState<{ forId: string; times: string[] } | null>(null);
  const [slotsError, setSlotsError] = useState("");
  // Re-renders once a minute. This is only useful because every time-derived
  // value below is computed from `now` at RENDER time — the first draft ticked
  // a counter while re-reading a minutesUntil the SERVER had frozen at fetch,
  // so the countdown never moved, "Join call" never appeared, and a finished
  // interview sat in Upcoming still offering Reschedule.
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/client/interviews");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Could not load your interviews.");
        return;
      }
      const data = await res.json();
      setInterviews(data.interviews || []);
      setTruncated(data.truncated === true);
      setError("");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  /** Everything time-dependent, recomputed each render from `now`. */
  const timing = useCallback(
    (iv: Interview) => {
      const start = new Date(iv.startsAt).getTime();
      const end = start + iv.durationMinutes * 60_000;
      const cancelled = iv.bucket === "cancelled";
      return {
        bucket: (cancelled ? "cancelled" : now > end ? "past" : "upcoming") as Bucket,
        isLive: !cancelled && now >= start - JOIN_EARLY_MS && now <= end + OVERRUN_MS,
        minutesUntil: Math.round((start - now) / 60_000),
      };
    },
    [now]
  );

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { upcoming: 0, past: 0, cancelled: 0 };
    for (const i of interviews) c[timing(i).bucket]++;
    return c;
  }, [interviews, timing]);

  const next = useMemo(
    () =>
      interviews
        .filter((i) => timing(i).bucket === "upcoming")
        .sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt))[0] || null,
    [interviews, timing]
  );

  // Completed in the last 7 days — the header stat Atlas hardcodes as "3".
  const completedThisWeek = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86_400_000;
    // Counts interviews that actually TOOK PLACE in the window, not every
    // slot whose time has passed.
    return interviews.filter(
      (i) =>
        timing(i).bucket === "past" &&
        i.outcome === "took_place" &&
        new Date(i.startsAt).getTime() >= weekAgo
    ).length;
  }, [interviews, timing]);

  const visible = useMemo(
    () =>
      interviews
        .filter((i) => timing(i).bucket === tab)
        .sort((a, b) =>
          tab === "upcoming"
            ? +new Date(a.startsAt) - +new Date(b.startsAt)
            : +new Date(b.startsAt) - +new Date(a.startsAt)
        ),
    [interviews, tab, timing]
  );

  async function openReschedule(iv: Interview) {
    setMoving(iv.id);
    setSlots(null);
    setSlotsError("");
    setCardError(null);
    if (!iv.candidate) {
      // Cannot happen (candidate_id is not null), but a bare return left the
      // "Loading their open times…" line up forever.
      setSlotsError("We couldn't work out who this interview is with.");
      return;
    }
    // The candidate's own published availability, straight from the same
    // public RPC the booking flow uses (InterviewScheduler) — so this page
    // can never offer a time reschedule_interview will refuse.
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("candidate_open_slots", {
      p_candidate_id: iv.candidate.id,
    });
    // An RPC failure must not masquerade as "no availability" — that sentence
    // blames the candidate for our outage.
    if (rpcError) {
      setSlotsError("Couldn't load their open times just now. Try again in a moment.");
      return;
    }
    setSlots({
      forId: iv.id,
      times: Array.isArray(data)
        ? (data as { starts_at: string }[]).map((r) => r.starts_at).sort()
        : [],
    });
  }

  async function doReschedule(bookingId: string, startsAt: string) {
    setBusy(bookingId);
    setCardError(null);
    try {
      const res = await fetch("/api/interviews/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId, startsAt }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // The RPC is one transaction, so a failure really does mean the
        // original interview is untouched — worth saying.
        setCardError({
          id: bookingId,
          message: `${body.error || "Couldn't move it."} Your interview is unchanged.`,
        });
        return;
      }
      setMoving(null);
      await load();
    } catch {
      setCardError({ id: bookingId, message: "Could not reach the server. Your interview is unchanged." });
    } finally {
      setBusy(null);
    }
  }

  async function doCancel(bookingId: string) {
    if (!confirm("Cancel this interview? The candidate is told, and the time is released.")) return;
    setBusy(bookingId);
    setCardError(null);
    try {
      const res = await fetch("/api/interviews/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setCardError({ id: bookingId, message: body.error || "Couldn't cancel it." });
        return;
      }
      await load();
    } catch {
      setCardError({ id: bookingId, message: "Could not reach the server." });
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <section className="iv"><p className="iv-lead">Loading your interviews…</p></section>;

  if (error) {
    return (
      <section className="iv">
        <h1 className="iv-title">Your interviews</h1>
        <p className="iv-error">{error}</p>
      </section>
    );
  }

  return (
    <section className="iv">
      <div className="iv-head">
        <div>
          <h1 className="iv-title">Your interviews</h1>
          <p className="iv-lead">
            {interviews.length === 0
              ? "You haven't booked an interview yet. You can book one from any candidate's profile."
              : "Video calls happen here on StaffVA — there are no meeting links to share."}
          </p>
        </div>
        {interviews.length > 0 && (
          <div className="iv-stats">
            <span><strong>{counts.upcoming}</strong> upcoming</span>
            <span><strong>{completedThisWeek}</strong> in the last 7 days</span>
          </div>
        )}
      </div>

      {truncated && (
        <p className="iv-error">
          Showing your most recent 200 interviews. The counts above cover only those.
        </p>
      )}

      {interviews.length === 0 ? (
        <div className="iv-empty">
          <p>Interviews you book show up here — upcoming, past and cancelled.</p>
          <Link href="/browse" className="btn btn-primary">Browse candidates</Link>
        </div>
      ) : (
        <div className="iv-body">
          <div className="iv-main">
            <div className="iv-tabs" role="tablist" aria-label="Filter interviews">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  className={`iv-tab${tab === t.key ? " active" : ""}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                  <span className={`iv-tab-count${counts[t.key] === 0 ? " zero" : ""}`}>{counts[t.key]}</span>
                </button>
              ))}
            </div>

            {visible.length === 0 ? (
              <div className="iv-empty"><p>Nothing in this tab.</p></div>
            ) : (
              visible.map((iv) => {
                const gone = iv.candidate?.withdrawn ?? null;
                const t = timing(iv);
                return (
                  <article key={iv.id} className={`iv-card${t.isLive ? " live" : ""}${t.bucket === "cancelled" ? " cancelled" : ""}`}>
                    <div className="iv-card-top">
                      <div className="iv-when">
                        {t.bucket === "cancelled" ? "Was " : ""}{when(iv.startsAt)}
                        {t.bucket === "upcoming" && !t.isLive && (
                          <span className="iv-until">{untilLabel(t.minutesUntil)}</span>
                        )}
                      </div>
                      {/* Past states come from the status enum and the join
                          stamps, never from the clock. "Completed" for a row
                          that is merely old would assert an interview happened
                          when all we know is that its time went by — and rows
                          stay 'booked' for at least 50 minutes afterwards as a
                          matter of course. */}
                      <span className={`iv-status st-${t.bucket} oc-${iv.outcome ?? "none"}`}>
                        {t.isLive
                          ? "Live now"
                          : t.bucket === "upcoming"
                            ? "Confirmed"
                            : t.bucket === "cancelled"
                              ? "Cancelled"
                              : iv.outcome === "took_place"
                                ? "Took place"
                                : iv.outcome === "no_show"
                                  ? "No-show"
                                  : iv.anyoneJoined
                                    ? "One side joined"
                                    : "Time passed"}
                      </span>
                    </div>

                    <div className="iv-card-person">
                      <div
                        className="iv-avatar"
                        style={iv.candidate?.photo ? { backgroundImage: `url("${encodeURI(iv.candidate.photo)}")` } : undefined}
                        aria-hidden
                      >
                        {!iv.candidate?.photo && (iv.candidate?.displayName?.[0] || "?").toUpperCase()}
                      </div>
                      <div>
                        <div className="iv-name">{iv.candidate?.displayName || "Candidate"}</div>
                        {gone ? (
                          <div className="iv-gone">{gone}</div>
                        ) : (
                          <div className="iv-role">
                            {[iv.candidate?.roleCategory, iv.candidate?.country].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </div>
                      <div className="iv-duration">{iv.durationMinutes} min · StaffVA video</div>
                    </div>

                    {iv.rescheduledFrom && (
                      // "another", not "an earlier" — the RPC accepts any open
                      // slot, and the old start time is not sent here, so the
                      // direction is not ours to assert.
                      <p className="iv-note">Moved from another time.</p>
                    )}
                    {t.bucket === "cancelled" && (
                      <div className="iv-cancel">
                        <strong>
                          {iv.wasMoved
                            ? "Moved to another time."
                            : iv.cancelledBy === "candidate"
                              ? `${iv.candidate?.displayName || "The candidate"} cancelled this interview.`
                              : "You cancelled this interview."}
                        </strong>
                        {iv.cancelReason && <span>“{iv.cancelReason}”</span>}
                      </div>
                    )}

                    <div className="iv-actions">
                      {t.isLive && (
                        <Link href={`/interviews/${iv.id}`} className="btn btn-primary">Join call</Link>
                      )}
                      {t.bucket === "upcoming" && !t.isLive && (
                        <>
                          <Link href={`/interviews/${iv.id}`} className="btn btn-outline">Open</Link>
                          <a href={`/api/interviews/${iv.id}/ics`} className="btn btn-outline">Add to calendar</a>
                          <button className="btn btn-outline" onClick={() => openReschedule(iv)} disabled={!!gone}>
                            Reschedule
                          </button>
                          <button className="iv-danger" onClick={() => doCancel(iv.id)} disabled={busy === iv.id}>
                            {busy === iv.id ? "…" : "Cancel"}
                          </button>
                        </>
                      )}
                      {iv.candidate && !gone && (
                        <>
                          <Link href={`/inbox?candidate=${iv.candidate.id}`} className="btn btn-outline">Message</Link>
                          <Link href={`/candidate/${iv.candidate.id}`} className="btn btn-outline">Profile</Link>
                        </>
                      )}
                    </div>

                    {moving === iv.id && (
                      <div className="iv-slots">
                        <div className="iv-slots-head">
                          Pick a new time
                          <button className="iv-slots-close" onClick={() => setMoving(null)}>Cancel</button>
                        </div>
                        {slotsError && <p className="iv-slots-err">{slotsError}</p>}
                        {slots?.forId !== iv.id && !slotsError && (
                          <p className="iv-slots-empty">Loading their open times…</p>
                        )}
                        {slots?.forId === iv.id && slots.times.length === 0 && (
                          // Our own rules do some of this filtering — slots
                          // inside the 12-hour lead time and past the 14-day
                          // horizon are dropped before we ever see them — so
                          // this must not read as "they published nothing".
                          <p className="iv-slots-empty">
                            No open times in the next two weeks, at least 12 hours out. They may have
                            more availability outside that window — message them to agree a time.
                          </p>
                        )}
                        {slots?.forId === iv.id && slots.times.length > 0 && (
                          <div className="iv-slot-grid">
                            {slots.times.slice(0, 24).map((sa) => (
                              <button
                                key={sa}
                                className="iv-slot"
                                disabled={busy === iv.id}
                                onClick={() => doReschedule(iv.id, sa)}
                              >
                                {when(sa)}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {cardError?.id === iv.id && <p className="iv-card-err">{cardError.message}</p>}
                  </article>
                );
              })
            )}
          </div>

          <aside className="iv-side">
            {next ? (
              <div className="iv-next">
                <div className="iv-next-eyebrow">Next up</div>
                <div className="iv-next-count">{untilLabel(timing(next).minutesUntil)}</div>
                <div className="iv-next-meta">{when(next.startsAt)} · {next.durationMinutes} min</div>
                <div className="iv-next-with">{next.candidate?.displayName || "Candidate"}</div>
                {timing(next).isLive && (
                  <Link href={`/interviews/${next.id}`} className="btn btn-primary iv-next-join">Join call</Link>
                )}
              </div>
            ) : (
              <div className="iv-next idle">
                <div className="iv-next-eyebrow">Next up</div>
                <p>Nothing scheduled.</p>
              </div>
            )}

            <div className="iv-cal">
              <div className="iv-cal-head">The next 14 days</div>
              {/* A strip of real days, not Atlas's hand-placed month grid with
                  its dots typed in by hand and its year stuck in 2025. */}
              <div className="iv-cal-strip">
                {Array.from({ length: 14 }, (_, n) => {
                  const d = new Date();
                  d.setDate(d.getDate() + n);
                  const key = dayKey(d.toISOString());
                  const on = interviews.filter(
                    (i) => timing(i).bucket === "upcoming" && dayKey(i.startsAt) === key
                  ).length;
                  return (
                    <div key={key} className={`iv-cal-day${on > 0 ? " has" : ""}${n === 0 ? " today" : ""}`}>
                      <span className="iv-cal-dow">{d.toLocaleDateString("en-US", { weekday: "narrow" })}</span>
                      <span className="iv-cal-num">{d.getDate()}</span>
                      {on > 0 && <span className="iv-cal-dot" aria-label={`${on} interview${on === 1 ? "" : "s"}`} />}
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
