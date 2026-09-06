import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hasCronSecret } from "@/lib/auth";
import { notifyCandidate } from "@/lib/notifyCandidate";
import { sendEmail } from "@/lib/email";
import { PAUSE_AUTO_END_DAYS } from "@/lib/engagementLifecycle";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Completes engagements whose 14-day notice period has run out.
 *
 * Setting status='completed' is all the state change needed: the existing
 * engagement lock trigger unlocks the candidate (when no other active
 * engagement remains), the periods route refuses new periods on non-active
 * engagements, and funded money keeps its normal release path — which is
 * exactly what the contract's clause says happens.
 */
async function run(request: Request) {
  if (!hasCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = admin();
  // 'payment_failed' included: a single card decline mid-notice flips the
  // status, and completing only 'active' rows would freeze the countdown
  // forever — the termination date the signed clause promises would silently
  // never arrive. A failed funding attempt does not un-give notice.
  const nowIso = new Date().toISOString();
  const pauseCutoff = new Date(Date.now() - PAUSE_AUTO_END_DAYS * 24 * 3600 * 1000).toISOString();
  const [noticeDue, pausedOut] = await Promise.all([
    db
      .from("engagements")
      .select("id, client_id, candidate_id, ends_at, notice_given_by, status, paused_at")
      .in("status", ["active", "payment_failed"])
      .not("ends_at", "is", null)
      .lte("ends_at", nowIso),
    // The pause clause's other ending: "If the engagement remains paused for
    // thirty (30) consecutive days, this Agreement terminates as though
    // notice had been given and the notice period completed."
    db
      .from("engagements")
      .select("id, client_id, candidate_id, ends_at, notice_given_by, status, paused_at")
      .in("status", ["active", "payment_failed"])
      .not("paused_at", "is", null)
      .lte("paused_at", pauseCutoff),
  ]);
  const error = noticeDue.error ?? pausedOut.error;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const seen = new Set<string>();
  const due = [...(noticeDue.data ?? []), ...(pausedOut.data ?? [])]
    .map((e) => ({ ...e, cause: e.ends_at && e.ends_at <= nowIso ? "notice" : "pause" }))
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));

  let completed = 0;
  for (const e of due) {
    // CAS per row: a concurrent run or a manual release cannot double-fire
    // the notifications. A pause-out additionally fences on paused_at still
    // being past the cutoff — a resume landing between the select and this
    // write un-earns the completion, and a status-only CAS would end an
    // engagement its pauser just brought back.
    let flip = db
      .from("engagements")
      .update({ status: "completed", paused_at: null, paused_by: null })
      .eq("id", e.id)
      .in("status", ["active", "payment_failed"]);
    if (e.cause === "pause") {
      flip = flip.not("paused_at", "is", null).lte("paused_at", pauseCutoff);
    }
    const { data: flipped } = await flip.select("id").maybeSingle();
    if (!flipped) continue;
    completed++;

    // "You're back in matching" is only true when no OTHER active engagement
    // keeps the lock trigger's hold — a candidate can accept new work during
    // notice, and telling a still-locked person they are browsable is the
    // copy-claims-what-code-doesn't defect in one sentence.
    const { count: otherActive } = await db
      .from("engagements")
      .select("id", { count: "exact", head: true })
      .eq("candidate_id", e.candidate_id)
      .eq("status", "active");
    const ending =
      e.cause === "pause"
        ? "It stayed paused for 30 days, so it ended under the agreement's pause clause."
        : "The 14-day notice period is over.";
    await notifyCandidate(db, {
      candidateId: e.candidate_id,
      category: "contract",
      title: "Your engagement has ended",
      body: otherActive
        ? `${ending} Your other engagement continues, and any funded money follows the normal release process.`
        : `${ending} You're back in matching, and any funded money follows the normal release process.`,
      route: "/candidate/dashboard",
      dedupeKey: `notice-complete-${e.id}`,
    });

    const { data: client } = await db
      .from("clients").select("email").eq("id", e.client_id).maybeSingle();
    if (client?.email) {
      try {
        await sendEmail({
          from: "StaffVA <notifications@staffva.com>",
          to: client.email,
          subject: "Your engagement has ended — notice period complete",
          html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
            <h2 style="color:#1C1B1A;">Engagement complete</h2>
            <p style="color:#444;font-size:14px;">${e.cause === "pause" ? "The engagement stayed paused for 30 days, so it has ended under the agreement's pause clause." : "The 14-day notice period has ended and the engagement is now closed."} Funds in escrow follow the normal release process; anything funded and owed still reaches your contractor.</p>
          </div>`,
        }, { recipientKind: "client", emailType: "engagement_notice_complete" });
      } catch (err) {
        // The team page shows the completed state regardless, but a failed
        // send must land where the failure query looks, not in a void.
        await db.from("vendor_failures").insert({
          app: "platform",
          vendor: "resend",
          operation: "email.engagement_notice_complete",
          fatal: false,
          message: (err instanceof Error ? err.message : String(err)).slice(0, 2000),
          context: { engagementId: e.id },
        });
      }
    }
  }

  return NextResponse.json({ due: due.length, completed });
}

// Vercel crons invoke with GET — the auto-release lesson, applied on day one.
export async function GET(request: Request) {
  return run(request);
}
export async function POST(request: Request) {
  return run(request);
}
