import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * The candidate's half of the revision loop, which never existed: staff could
 * put someone into revision_required and the card told them "then resubmit",
 * but the only resubmit action lived in a staff-gated admin route. The
 * candidate stayed revision_required forever and the reviewer's pending list
 * never cleared.
 *
 * Mirrors the admin resubmit action exactly (same target status, same
 * change-request resolution) so both doors lead to the same room.
 */
export async function POST() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const db = admin();
  const { data: candidate } = await db
    .from("candidates")
    .select("id, admin_status, display_name, full_name")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!candidate) return NextResponse.json({ error: "No candidate profile" }, { status: 404 });

  // CAS on the two revision states — a double-click or a stale tab cannot
  // bounce someone who was already re-reviewed.
  const { data: flipped } = await db
    .from("candidates")
    .update({ admin_status: "under_review" })
    .eq("id", candidate.id)
    .in("admin_status", ["revision_required", "changes_requested"])
    .select("id")
    .maybeSingle();

  if (!flipped) {
    return NextResponse.json(
      { error: "There's nothing waiting on you right now — your application is already with the review team." },
      { status: 409 }
    );
  }

  await db
    .from("candidate_change_requests")
    .update({ resolved_at: new Date().toISOString(), status: "resolved" })
    .eq("candidate_id", candidate.id)
    .eq("status", "pending");

  await db.from("candidate_status_events").insert({
    candidate_id: candidate.id,
    from_status: "revision_required",
    to_status: "under_review",
    actor_id: user.id,
    actor_role: "candidate",
    reason: "Candidate resubmitted after revisions",
  });

  // Staff mail is operational, not under the candidate freeze.
  if (process.env.RESEND_API_KEY) {
    const name = candidate.display_name || candidate.full_name || "A candidate";
    try {
      await sendEmail({
        from: "StaffVA <notifications@staffva.com>",
        to: "sam@glostaffing.com",
        subject: `Candidate has resubmitted for review — ${name}`,
        html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
          <h2 style="color:#1C1B1A;">Profile Resubmitted</h2>
          <p style="color:#444;font-size:14px;"><strong>${name}</strong> updated their application and sent it back for review.</p>
        </div>`,
      }, { recipientKind: "staff", emailType: "resubmitted_for_review" });
    } catch { /* silent */ }
  }

  return NextResponse.json({ success: true });
}
