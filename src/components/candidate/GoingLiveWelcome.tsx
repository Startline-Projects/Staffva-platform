"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Shown once, the first time a newly approved candidate opens their dashboard.
 *
 * "Once" is enforced in the database, not here: ack_going_live() only writes
 * when going_live_ack_at is null, and migration 00186 backfilled the 31 people
 * already on the marketplace — some live since April — so nobody gets
 * congratulated on being approved months after the fact.
 *
 * It says what changes and what does not. No confetti and no promises about
 * clients getting in touch: nothing in this platform can predict that, and the
 * dashboard has enough copy already claiming things the code doesn't do.
 */
export default function GoingLiveWelcome({ firstName }: { firstName: string }) {
  const [dismissed, setDismissed] = useState(false);

  async function dismiss() {
    // Optimistic: the acknowledgement is a courtesy, and a failed write only
    // means they see this again — never a lost action.
    setDismissed(true);
    try {
      await createClient().rpc("ack_going_live");
    } catch {
      /* shown again next visit, which is the harmless direction */
    }
  }

  if (dismissed) return null;

  return (
    <section className="mb-6 rounded-lg border border-green-200 bg-green-50 p-5">
      <h2 className="text-lg font-bold text-green-900">
        You&apos;re approved, {firstName} — your profile is on the marketplace.
      </h2>
      <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-green-800">
        Clients can now find you, read your profile and get in touch. Two things
        are worth doing today: check your rate and availability below are still
        what you want, and set the hours clients can book a call with you.
      </p>
      <button
        onClick={dismiss}
        className="mt-3 rounded-full bg-green-700 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-800"
      >
        Got it
      </button>
    </section>
  );
}
