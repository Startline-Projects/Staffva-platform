import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hasCronSecret } from "@/lib/auth";
import { notifyCandidate } from "@/lib/notifyCandidate";
import { sendEmail } from "@/lib/email";

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
  const { data: due, error } = await db
    .from("engagements")
    .select("id, client_id, candidate_id, ends_at, notice_given_by, status")
    .in("status", ["active", "payment_failed"])
    .not("ends_at", "is", null)
    .lte("ends_at", new Date().toISOString());
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let completed = 0;
  for (const e of due ?? []) {
    // CAS per row: a concurrent run or a manual release cannot double-fire
    // the notifications.
    const { data: flipped } = await db
      .from("engagements")
      .update({ status: "completed" })
      .eq("id", e.id)
      .in("status", ["active", "payment_failed"])
      .select("id")
      .maybeSingle();
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
    await notifyCandidate(db, {
      candidateId: e.candidate_id,
      category: "contract",
      title: "Your engagement has ended",
      body: otherActive
        ? "The 14-day notice period is over. Your other engagement continues, and any funded money follows the normal release process."
        : "The 14-day notice period is over. You're back in matching, and any funded money follows the normal release process.",
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
            <p style="color:#444;font-size:14px;">The 14-day notice period has ended and the engagement is now closed. Funds in escrow follow the normal release process; anything funded and owed still reaches your contractor.</p>
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

  return NextResponse.json({ due: (due ?? []).length, completed });
}

// Vercel crons invoke with GET — the auto-release lesson, applied on day one.
export async function GET(request: Request) {
  return run(request);
}
export async function POST(request: Request) {
  return run(request);
}
