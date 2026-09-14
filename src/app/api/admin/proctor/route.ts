import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * GET  /api/admin/proctor — flagged proctor sessions awaiting a human
 *      decision, plus recently decided ones. This surface is the missing
 *      half of the consent promise: the cron flags, a person decides here.
 * POST /api/admin/proctor — record that decision.
 *
 * The decision ONLY moves the session's review_status and stamps
 * decided_at. Footage deletion belongs to the proctor-review cron (its
 * decided-evidence phase deletes 7 days after decided_at) — deleting here
 * would race it and break "kept until a decision and 7 days after".
 */

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function verifyAdmin() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = getAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, full_name, email").eq("id", user.id).single();
  return (profile?.role === "admin" || profile?.role === "recruiting_manager") ? { ...user, adminName: profile.full_name, adminEmail: profile.email } : null;
}

/** The decide note is free-form admin input headed into an HTML email body. */
const escHtml = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function notifyAdmin(action: string, detail: string, adminName: string) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    await sendEmail({
      from: "StaffVA <notifications@staffva.com>",
      to: "sam@glostaffing.com",
      subject: `Admin action: ${action}`,
      html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;">
        <h2 style="color:#1C1B1A;">${action}</h2>
        <p style="color:#444;font-size:14px;">${detail}</p>
        <p style="color:#999;font-size:12px;">By: ${escHtml(adminName)} at ${new Date().toLocaleString()}</p>
      </div>`,
    }, { recipientKind: "staff", emailType: "admin_action_alert" });
  } catch { /* silent */ }
}

interface CandidateRef { id: string; display_name: string | null; full_name: string | null; email: string | null; country?: string | null }

async function enrichWithCandidates<T extends { candidate_id: string }>(
  supabase: ReturnType<typeof getAdminClient>,
  sessions: T[]
): Promise<(T & { candidate: CandidateRef | null })[]> {
  const ids = [...new Set(sessions.map((s) => s.candidate_id).filter(Boolean))];
  const { data: candidates } = await supabase
    .from("candidates")
    .select("id, display_name, full_name, email, country")
    .in("id", ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const map = new Map((candidates || []).map((c) => [c.id, c]));
  return sessions.map((s) => ({ ...s, candidate: map.get(s.candidate_id) || null }));
}

const SESSION_COLUMNS =
  "id, candidate_id, session_kind, attempt_id, storage_prefix, chunk_count, frame_count, camera_lost_count, started_at, ended_at, review_status, verdict, reviewed_at, video_deleted_at, decided_at";

// GET — flagged queue + decided history
export async function GET() {
  const admin = await verifyAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const supabase = getAdminClient();

  // count:"exact" reports the TRUE decided total even though the list itself
  // is capped at the 100 most recent — the cap must not masquerade as the total.
  const [{ data: flagged }, { data: decided, count: decidedCount }] = await Promise.all([
    supabase
      .from("proctor_sessions")
      .select(SESSION_COLUMNS)
      .eq("review_status", "flagged")
      .order("started_at", { ascending: true }),
    supabase
      .from("proctor_sessions")
      .select(SESSION_COLUMNS, { count: "exact" })
      .in("review_status", ["cleared_by_human", "confirmed_cheating"])
      .order("decided_at", { ascending: false })
      .limit(100),
  ]);

  const [enrichedFlagged, enrichedDecided] = await Promise.all([
    enrichWithCandidates(supabase, flagged || []),
    enrichWithCandidates(supabase, decided || []),
  ]);

  const oldest = enrichedFlagged[0]?.started_at;
  return NextResponse.json({
    flagged: enrichedFlagged,
    decided: enrichedDecided,
    summary: {
      flagged: enrichedFlagged.length,
      decided: decidedCount ?? enrichedDecided.length,
      oldestFlaggedDays: oldest ? Math.floor((Date.now() - new Date(oldest).getTime()) / (1000 * 60 * 60 * 24)) : null,
    },
  });
}

// POST — record the human decision on a flagged session
export async function POST(req: NextRequest) {
  const admin = await verifyAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { action, sessionId, decision, note } = await req.json();
  if (action !== "decide") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  if (decision !== "cleared_by_human" && decision !== "confirmed_cheating") {
    return NextResponse.json({ error: "decision must be cleared_by_human or confirmed_cheating" }, { status: 400 });
  }

  const supabase = getAdminClient();
  const { data: session } = await supabase
    .from("proctor_sessions")
    .select("id, candidate_id, session_kind, review_status, verdict, reviewed_at")
    .eq("id", sessionId)
    .single();
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (session.review_status !== "flagged") {
    return NextResponse.json({ error: `Session is '${session.review_status}', not 'flagged' — only flagged sessions take a decision` }, { status: 409 });
  }

  const nowIso = new Date().toISOString();
  const verdict = {
    ...((session.verdict as Record<string, unknown>) || {}),
    // The who/why of the decision rides inside verdict jsonb — the
    // admin_actions audit table is not in the live schema yet.
    human_decision: {
      decision,
      note: typeof note === "string" && note.trim() ? note.trim().slice(0, 1000) : null,
      decided_by: admin.id,
      decided_by_name: admin.adminName || "Admin",
      decided_at: nowIso,
    },
  };

  // .eq("review_status","flagged") makes a double-decide race lose cleanly
  // instead of overwriting the first decision (and restarting its 7-day
  // deletion clock).
  const { data: won, error: updateError } = await supabase
    .from("proctor_sessions")
    .update({
      review_status: decision,
      decided_at: nowIso,
      reviewed_at: session.reviewed_at ?? nowIso,
      verdict,
    })
    .eq("id", sessionId)
    .eq("review_status", "flagged")
    .select("id");
  if (updateError) {
    return NextResponse.json({ error: "The decision was not recorded — database error, try again" }, { status: 500 });
  }
  if (!won?.length) {
    return NextResponse.json({ error: "Session was decided by someone else just now" }, { status: 409 });
  }

  // Deliberately NOT touching the candidate row on confirmed_cheating:
  // whether a confirmation blocks, demotes, or re-tests the candidate is an
  // owner policy decision that hasn't been made. This route records what a
  // human concluded about the SESSION; consequences for the person are a
  // separate, pending decision. (Candidate emails are frozen anyway —
  // src/lib/emailFreeze.ts — so nothing is sent to them from here either.)
  await notifyAdmin(
    "Proctor Session Decision",
    `Session ${escHtml(sessionId)} (${escHtml(session.session_kind)}, candidate ${escHtml(session.candidate_id)}) marked <b>${decision}</b>.` +
      `${typeof note === "string" && note.trim() ? ` Note: ${escHtml(note.trim().slice(0, 1000))}` : ""}` +
      ` Footage auto-deletes 7 days after this decision.` +
      (decision === "confirmed_cheating" ? " No action was taken against the candidate — consequences are a pending owner decision." : ""),
    admin.adminName || "Admin"
  );

  return NextResponse.json({ success: true, decided_at: nowIso });
}
