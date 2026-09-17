import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { recordAdminAction } from "@/lib/adminAudit";
import { sendEmail } from "@/lib/email";
import { invalidateDormancyCache } from "@/lib/adminDormancy";

/**
 * Move a whole queue off one specialist and onto another.
 *
 * `/api/admin/reassign` moves one candidate and mails three people about it.
 * Looping it over a queue of sixty-three would have sent the outgoing
 * specialist sixty-three separate "action required" notices — to an inbox
 * nobody has opened since April, which is the reason the queue is being
 * drained. The whole point of the bulk path is that it is ONE decision, so it
 * sends one summary each way.
 *
 * Candidates are not mailed. Their reassignment notice is under the candidate
 * email freeze and would be suppressed regardless, but even unfrozen, sixty-
 * three near-identical "your specialist has changed" messages is not news, and
 * the in-platform assignment is what they actually see.
 *
 * The move is bounded to the exact ids that were read, so the log and the
 * update describe the same set — a candidate assigned to the outgoing
 * specialist between the read and the write stays put rather than moving
 * silently and unlogged.
 */

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function requireStaff() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const role = user.app_metadata?.role;
  if (role !== "admin" && role !== "recruiting_manager") return null;
  const { data: profile } = await admin()
    .from("profiles").select("id, full_name, email, role").eq("id", user.id).single();
  if (!profile) return null;
  return profile as { id: string; full_name: string | null; email: string; role: "admin" | "recruiting_manager" };
}

export async function POST(req: NextRequest) {
  const actor = await requireStaff();
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const fromRecruiterId = typeof body.fromRecruiterId === "string" ? body.fromRecruiterId : "";
  const toRecruiterId = typeof body.toRecruiterId === "string" ? body.toRecruiterId : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!fromRecruiterId || !toRecruiterId) {
    return NextResponse.json({ error: "Both a source and a destination are required." }, { status: 400 });
  }
  if (fromRecruiterId === toRecruiterId) {
    return NextResponse.json({ error: "That is the specialist the queue is already on." }, { status: 400 });
  }

  const db = admin();

  const { data: people, error: peopleErr } = await db
    .from("profiles").select("id, full_name, email").in("id", [fromRecruiterId, toRecruiterId]);
  if (peopleErr) return NextResponse.json({ error: "Could not read the specialists." }, { status: 500 });
  const from = people?.find((p) => p.id === fromRecruiterId);
  const to = people?.find((p) => p.id === toRecruiterId);
  if (!from || !to) return NextResponse.json({ error: "Specialist not found." }, { status: 404 });

  // `assigned_recruiter` is a text column holding uuids.
  const { data: queue, error: queueErr } = await db
    .from("candidates").select("id").eq("assigned_recruiter", fromRecruiterId);
  if (queueErr) return NextResponse.json({ error: "Could not read the queue." }, { status: 500 });

  const ids = (queue ?? []).map((c) => c.id as string);
  if (ids.length === 0) {
    return NextResponse.json({ error: `${from.full_name ?? "That specialist"} has no candidates assigned.` }, { status: 400 });
  }

  const { error: moveErr } = await db
    .from("candidates")
    .update({ assigned_recruiter: toRecruiterId, assigned_recruiter_at: new Date().toISOString() })
    .in("id", ids);
  if (moveErr) {
    return NextResponse.json({ error: `The queue was not moved: ${moveErr.message}` }, { status: 500 });
  }

  // The bell's dormancy answer is cached for a few seconds and has just been
  // made wrong by this write.
  invalidateDormancyCache();

  // From here the move HAS happened. Everything below is bookkeeping, and a
  // failure in it is reported as exactly that — never as a failed move, which
  // would invite a retry that moves an already-moved queue a second time.
  const warnings: string[] = [];

  const { error: logErr } = await db.from("recruiter_reassignment_log").insert(
    ids.map((candidateId) => ({
      candidate_id: candidateId,
      reassigned_by: actor.id,
      from_recruiter_id: fromRecruiterId,
      to_recruiter_id: toRecruiterId,
      reason: reason || "Queue drained: specialist not signing in",
    }))
  );
  if (logErr) warnings.push("the per-candidate reassignment log was not written");

  const recorded = await recordAdminAction({
    actorId: actor.id,
    actorRole: actor.role,
    action: "candidate.reassign_bulk",
    subjectType: "profile",
    subjectId: fromRecruiterId,
    summary: `Moved ${ids.length} candidate${ids.length === 1 ? "" : "s"} from ${from.full_name ?? from.email} to ${to.full_name ?? to.email}`,
    detail: { fromRecruiterId, toRecruiterId, count: ids.length, reason: reason || null, candidateIds: ids },
  });
  if (!recorded) warnings.push("the action was not written to the audit log");

  // One notification, not one per candidate.
  const { error: notifyErr } = await db.from("recruiter_notifications").insert({
    recruiter_id: fromRecruiterId,
    candidate_id: null,
    message: `${ids.length} candidate${ids.length === 1 ? "" : "s"} previously assigned to you ${ids.length === 1 ? "has" : "have"} been moved to ${to.full_name ?? to.email}. You are no longer their point of contact.`,
    priority: "high",
  });
  if (notifyErr) warnings.push("the outgoing specialist was not notified in-platform");

  const wrap = (b: string) =>
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">${b}<p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p></div>`;
  const n = `${ids.length} candidate${ids.length === 1 ? "" : "s"}`;

  // Staff mail is not under the freeze; failures here are not the caller's
  // problem and must not fail an action that already happened.
  await Promise.all([
    from.email && sendEmail(
      { from: "StaffVA <notifications@staffva.com>", to: from.email,
        subject: "Your assigned candidates have been moved",
        html: wrap(`<p style="color:#444;font-size:14px;">${n} previously assigned to you ${ids.length === 1 ? "has" : "have"} been reassigned to <strong>${to.full_name ?? to.email}</strong>. No action is needed from you.</p>`) },
      { recipientKind: "staff", emailType: "queue_reassigned_away" }
    ).catch(() => {}),
    to.email && sendEmail(
      { from: "StaffVA <notifications@staffva.com>", to: to.email,
        subject: `${n} assigned to you`,
        html: wrap(`<p style="color:#444;font-size:14px;">${n} previously assigned to <strong>${from.full_name ?? from.email}</strong> ${ids.length === 1 ? "is" : "are"} now yours.${reason ? ` Reason given: ${reason}.` : ""}</p>`) },
      { recipientKind: "staff", emailType: "queue_assigned_to_you" }
    ).catch(() => {}),
  ]);

  return NextResponse.json({ moved: ids.length, warnings });
}
