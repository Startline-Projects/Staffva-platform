"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * One interview, for either party. This page is the URL every scheduler
 * email points at, so it has to be honest in every state: upcoming (with a
 * plain statement of when the call link appears — the room itself is a later
 * step), cancelled (by whom, and what to do next), and past.
 */

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
}

function viewerZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function fmtInZone(iso: string, tz: string, withDate: boolean): string {
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
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const [vz] = useState(() => viewerZone());
  const [loadedAt] = useState(() => Date.now());

  useEffect(() => {
    async function run() {
      const res = await fetch(`/api/interviews/${id}`);
      if (!res.ok) {
        setState("missing");
        return;
      }
      setDetail(await res.json());
      setState("ready");
    }
    run();
  }, [id]);

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

  const { booking, viewerRole, counterpart, candidatePath } = detail;
  const who = counterpart.company ? `${counterpart.name} · ${counterpart.company}` : counterpart.name;
  const firstName = counterpart.name.split(" ")[0];
  const isBooked = booking.status === "booked";
  const isPast = new Date(booking.startsAt).getTime() < loadedAt;
  const cancelledByViewer =
    booking.status === (viewerRole === "client" ? "cancelled_by_client" : "cancelled_by_candidate");
  const theirTime =
    counterpart.tz && counterpart.tz !== vz ? fmtInZone(booking.startsAt, counterpart.tz, false) : null;

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
        {viewerRole === "client" ? "Your interview" : "Client interview"}
      </p>
      <h1 className="mt-1 text-xl font-semibold text-text">{who}</h1>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6">
        <p className="text-sm text-text">
          {fmtInZone(booking.startsAt, vz, true)}{" "}
          <span className="text-text-tertiary">· {booking.durationMinutes} minutes</span>
        </p>
        <p className="mt-0.5 text-xs text-text-tertiary">
          Times shown in your timezone{theirTime ? ` — that's ${theirTime} for ${firstName}` : ""}
        </p>

        {isBooked && !isPast && (
          <div className="mt-5 rounded-lg border border-gray-100 bg-gray-50 p-4">
            <p className="text-sm font-medium text-text">Video call on StaffVA</p>
            <p className="mt-1 text-xs leading-relaxed text-text-secondary">
              The call link appears right here 15 minutes before the start — no downloads, it runs
              in your browser. You&apos;ll also get reminders by email a day ahead and an hour
              ahead.
            </p>
          </div>
        )}

        {isBooked && isPast && (
          <p className="mt-5 text-sm text-text-secondary">This interview time has passed.</p>
        )}

        {!isBooked && (
          <div className="mt-5 rounded-lg border border-gray-100 bg-gray-50 p-4">
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

        {isBooked && !isPast && !confirmingCancel && (
          <button
            onClick={() => setConfirmingCancel(true)}
            className="mt-5 text-xs text-text-tertiary underline decoration-border underline-offset-2 hover:text-text"
          >
            Cancel this interview
          </button>
        )}

        {confirmingCancel && isBooked && (
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

      <div className="mt-4 text-sm">
        {viewerRole === "client" && candidatePath ? (
          <Link href={candidatePath} className="text-text-secondary underline decoration-border underline-offset-2 hover:text-text">
            View {firstName}&apos;s profile
          </Link>
        ) : (
          <Link href="/candidate/dashboard" className="text-text-secondary underline decoration-border underline-offset-2 hover:text-text">
            Back to your dashboard
          </Link>
        )}
      </div>
    </div>
  );
}
