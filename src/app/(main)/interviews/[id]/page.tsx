"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import InterviewCall from "@/components/interview/InterviewCall";

/**
 * One interview, for either party. This page is the URL every scheduler
 * email points at, so it has to be honest in every state: consent first
 * (recording is a property of the interview, not a button), a plain
 * statement of when the room opens, the call itself once the window is
 * open, cancelled (by whom, and what to do next), and past.
 *
 * Join-window decisions use the SERVER's clock (serverNow + elapsed), not
 * the viewer's — a laptop five minutes fast should not unlock a room early.
 */

const JOIN_EARLY_MS = 15 * 60 * 1000; // mirrors the room route
const OVERRUN_MS = 45 * 60 * 1000;

interface Detail {
  booking: {
    id: string;
    startsAt: string;
    durationMinutes: number;
    status: string;
    cancelledAt: string | null;
  };
  viewerRole: "client" | "candidate";
  counterpart: { name: string; company: string | null; tz: string | null };
  candidatePath: string | null;
  myConsentAt: string | null;
  serverNow: string;
}

function viewerZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function fmtInZone(iso: string | number, tz: string, withDate: boolean): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      ...(withDate ? { weekday: "long", month: "long", day: "numeric" } : {}),
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toUTCString();
  }
}

export default function InterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [skewMs, setSkewMs] = useState(0);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [consenting, setConsenting] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [leftOnce, setLeftOnce] = useState(false);
  const [error, setError] = useState("");
  const [vz] = useState(() => viewerZone());

  useEffect(() => {
    async function run() {
      const res = await fetch(`/api/interviews/${id}`);
      if (!res.ok) {
        setState("missing");
        return;
      }
      const data: Detail = await res.json();
      setDetail(data);
      setSkewMs(new Date(data.serverNow).getTime() - Date.now());
      setState("ready");
    }
    run();
  }, [id]);

  // Keep the join window fresh without a reload; 15s is plenty for a
  // 15-minute-early door.
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  // While the booking is live, keep asking the server about it — a
  // cancellation from the other side has to reach a page that is already
  // open, including one that is in the call right now.
  useEffect(() => {
    if (state !== "ready" || detail?.booking.status !== "booked") return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/interviews/${id}`);
      if (!res.ok) return;
      const data: Detail = await res.json();
      setDetail(data);
      setSkewMs(new Date(data.serverNow).getTime() - Date.now());
    }, 15_000);
    return () => clearInterval(t);
  }, [state, detail?.booking.status, id]);

  async function agree() {
    if (consenting) return;
    setConsenting(true);
    setError("");
    const res = await fetch(`/api/interviews/${id}/consent`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setConsenting(false);
    if (!res.ok) {
      setError(data.error || "Could not save — try again.");
      return;
    }
    setDetail((d) => (d ? { ...d, myConsentAt: data.consentedAt } : d));
  }

  async function cancel() {
    if (cancelling) return;
    setCancelling(true);
    setError("");
    const res = await fetch("/api/interviews/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId: id, reason: reason.trim() || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    setCancelling(false);
    if (!res.ok) {
      setError(data.error || "Could not cancel — try again.");
      return;
    }
    setDetail((d) => (d ? { ...d, booking: { ...d.booking, status: data.status } } : d));
    setConfirmingCancel(false);
    router.refresh();
  }

  if (state === "loading") {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-text-tertiary">
          Loading your interview…
        </div>
      </div>
    );
  }

  if (state === "missing" || !detail) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <h1 className="text-base font-semibold text-text">Interview not found</h1>
          <p className="mt-2 text-sm text-text-tertiary">
            This link may be for a different account — check you&apos;re signed in with the email
            the booking was made under.
          </p>
          <Link
            href="/login"
            className="mt-4 inline-block rounded-lg bg-text px-4 py-2 text-sm font-semibold text-white"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const { booking, viewerRole, counterpart, candidatePath, myConsentAt } = detail;
  const who = counterpart.company ? `${counterpart.name} · ${counterpart.company}` : counterpart.name;
  const firstName = counterpart.name.split(" ")[0];
  const isBooked = booking.status === "booked";
  const cancelledByViewer =
    booking.status === (viewerRole === "client" ? "cancelled_by_client" : "cancelled_by_candidate");
  const theirTime =
    counterpart.tz && counterpart.tz !== vz ? fmtInZone(booking.startsAt, counterpart.tz, false) : null;

  const now = nowTick + skewMs;
  const startsMs = new Date(booking.startsAt).getTime();
  const opensAt = startsMs - JOIN_EARLY_MS;
  const closesAt = startsMs + booking.durationMinutes * 60_000 + OVERRUN_MS;
  const isPast = now > closesAt;
  const windowOpen = now >= opensAt && now <= closesAt;
  // Cancelling makes sense up to the start; after that the interview is
  // happening (or already happened) and "cancel" would be a false record.
  const started = now >= startsMs;

  const wide = inCall && isBooked && windowOpen;

  return (
    <div className={`mx-auto px-4 py-12 ${wide ? "max-w-4xl" : "max-w-lg"}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
        {viewerRole === "client" ? "Your interview" : "Client interview"}
      </p>
      <h1 className="mt-1 text-xl font-semibold text-text">{who}</h1>
      <p className="mt-1 text-sm text-text-secondary">
        {fmtInZone(booking.startsAt, vz, true)}{" "}
        <span className="text-text-tertiary">· {booking.durationMinutes} minutes</span>
      </p>
      <p className="mt-0.5 text-xs text-text-tertiary">
        Times shown in your timezone{theirTime ? ` — that's ${theirTime} for ${firstName}` : ""}
      </p>

      {/* ── In the call ── */}
      {wide ? (
        <div className="mt-6">
          <InterviewCall
            bookingId={booking.id}
            onLeft={() => {
              setInCall(false);
              setLeftOnce(true);
            }}
          />
        </div>
      ) : (
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6">
          {/* ── Upcoming, not yet consented ── */}
          {isBooked && !isPast && !myConsentAt && (
            <div>
              <h2 className="text-sm font-semibold text-text">Before you join</h2>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                Interviews on StaffVA are recorded and transcribed, and reviewed to keep the
                marketplace safe for both sides. By continuing, you agree to be recorded.
              </p>
              <button
                onClick={agree}
                disabled={consenting}
                className="mt-4 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {consenting ? "Saving…" : "Agree and continue"}
              </button>
            </div>
          )}

          {/* ── Upcoming, consented, room not open yet ── */}
          {isBooked && !isPast && myConsentAt && !windowOpen && (
            <div>
              <p className="text-sm font-medium text-text">You&apos;re all set.</p>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                The join button appears here 15 minutes before the start — at{" "}
                {fmtInZone(opensAt, vz, false)}. No downloads; the call runs in your browser.
              </p>
            </div>
          )}

          {/* ── Window open ── */}
          {isBooked && myConsentAt && windowOpen && (
            <div>
              <p className="text-sm font-medium text-text">
                {leftOnce ? "You left the call." : "Your room is open."}
              </p>
              <p className="mt-1 text-xs text-text-secondary">
                {leftOnce
                  ? "You can rejoin until the room closes."
                  : "A camera and mic check comes first — you won't drop straight into the call."}
              </p>
              <button
                onClick={() => setInCall(true)}
                className="mt-4 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90"
              >
                {leftOnce ? "Rejoin the interview" : "Join the interview"}
              </button>
            </div>
          )}

          {/* ── Past ── */}
          {isBooked && isPast && (
            <p className="text-sm text-text-secondary">This interview time has passed.</p>
          )}

          {/* ── Cancelled / completed ── */}
          {!isBooked && (
            <div>
              <p className="text-sm font-medium text-text">
                {booking.status === "completed"
                  ? "This interview is complete."
                  : cancelledByViewer
                    ? "You cancelled this interview."
                    : `${firstName} cancelled this interview.`}
              </p>
              {booking.status !== "completed" && (
                <p className="mt-1 text-xs text-text-secondary">
                  {viewerRole === "client" && candidatePath
                    ? "Their calendar is open if you'd like to pick a new time."
                    : "The slot is open on your calendar again."}
                </p>
              )}
            </div>
          )}

          {/* ── Cancel control ── */}
          {isBooked && !started && !confirmingCancel && (
            <button
              onClick={() => setConfirmingCancel(true)}
              className="mt-5 text-xs text-text-tertiary underline decoration-border underline-offset-2 hover:text-text"
            >
              Cancel this interview
            </button>
          )}

          {confirmingCancel && isBooked && !started && (
            <div className="mt-5 border-t border-gray-100 pt-4">
              <p className="text-sm text-text">
                Cancel your interview with {firstName}? They&apos;ll be told right away.
              </p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={300}
                rows={2}
                placeholder="Add a short note (optional)"
                className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-text placeholder:text-text-tertiary focus:border-gray-400 focus:outline-none"
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={cancel}
                  disabled={cancelling}
                  className="rounded-lg bg-text px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {cancelling ? "Cancelling…" : "Yes, cancel it"}
                </button>
                <button
                  onClick={() => setConfirmingCancel(false)}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-medium text-text-secondary hover:border-gray-400"
                >
                  Keep the interview
                </button>
              </div>
            </div>
          )}

          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        </div>
      )}

      <div className="mt-4 text-sm">
        {viewerRole === "client" && candidatePath ? (
          <Link
            href={candidatePath}
            className="text-text-secondary underline decoration-border underline-offset-2 hover:text-text"
          >
            View {firstName}&apos;s profile
          </Link>
        ) : (
          <Link
            href="/candidate/dashboard"
            className="text-text-secondary underline decoration-border underline-offset-2 hover:text-text"
          >
            Back to your dashboard
          </Link>
        )}
      </div>
    </div>
  );
}
