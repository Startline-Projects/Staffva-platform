import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function verifyAdmin() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = getAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, full_name, email").eq("id", user.id).single();
  return profile?.role === "admin" ? { ...user, adminName: profile.full_name, adminEmail: profile.email } : null;
}

async function notifyAdmin(action: string, detail: string, adminName: string) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    await resend.emails.send({
      from: "StaffVA <notifications@staffva.com>",
      to: "sam@glostaffing.com",
      subject: `Admin action: ${action}`,
      html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;">
        <h2 style="color:#1C1B1A;">${action}</h2>
        <p style="color:#444;font-size:14px;">${detail}</p>
        <p style="color:#999;font-size:12px;">By: ${adminName} at ${new Date().toLocaleString()}</p>
      </div>`,
    });
  } catch { /* silent */ }
}

// GET — fetch all identity management data
export async function GET() {
  const admin = await verifyAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const supabase = getAdminClient();
  const now = new Date().toISOString();

  // Active lockouts
  const { data: lockouts } = await supabase
    .from("english_test_lockouts")
    .select("*")
    .gt("lockout_expires_at", now)
    .order("lockout_expires_at", { ascending: true });

  const lockoutCandidateIds = [...new Set((lockouts || []).map((l) => l.candidate_id).filter(Boolean))];
  const { data: lockoutCandidates } = await supabase
    .from("candidates")
    .select("id, display_name, full_name, country, role_category")
    .in("id", lockoutCandidateIds.length > 0 ? lockoutCandidateIds : ["none"]);
  const lcMap = new Map((lockoutCandidates || []).map((c) => [c.id, c]));

  const enrichedLockouts = (lockouts || []).map((l) => ({
    ...l,
    candidate: lcMap.get(l.candidate_id) || null,
    days_remaining: Math.ceil((new Date(l.lockout_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
  }));

  // Duplicate accounts
  const { data: duplicates } = await supabase
    .from("verified_identities")
    .select("*")
    .eq("is_duplicate", true)
    .order("created_at", { ascending: false });

  const dupIds = new Set<string>();
  (duplicates || []).forEach((d) => { if (d.candidate_id) dupIds.add(d.candidate_id); if (d.duplicate_of_candidate_id) dupIds.add(d.duplicate_of_candidate_id); });
  const { data: dupCandidates } = await supabase
    .from("candidates")
    .select("id, display_name, full_name, email, country, role_category, admin_status")
    .in("id", [...dupIds].length > 0 ? [...dupIds] : ["none"]);
  const dcMap = new Map((dupCandidates || []).map((c) => [c.id, c]));

  const enrichedDuplicates = (duplicates || []).map((d) => ({
    ...d,
    candidate: dcMap.get(d.candidate_id) || null,
    original: d.duplicate_of_candidate_id ? dcMap.get(d.duplicate_of_candidate_id) || null : null,
  }));

  // Flagged for review
  const { data: flagged } = await supabase
    .from("verified_identities")
    .select("*")
    .eq("flagged_for_review", true)
    .order("created_at", { ascending: false });

  const flagIds = new Set<string>();
  (flagged || []).forEach((f) => { if (f.candidate_id) flagIds.add(f.candidate_id); });
  const { data: flagCandidates } = await supabase
    .from("candidates")
    .select("id, display_name, full_name, email, country, role_category")
    .in("id", [...flagIds].length > 0 ? [...flagIds] : ["none"]);
  const fcMap = new Map((flagCandidates || []).map((c) => [c.id, c]));

  const enrichedFlagged = (flagged || []).map((f) => ({
    ...f,
    candidate: fcMap.get(f.candidate_id) || null,
  }));

  // Summary stats
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count: totalVerifications } = await supabase
    .from("verified_identities")
    .select("*", { count: "exact", head: true });

  const { count: duplicatesThisWeek } = await supabase
    .from("verified_identities")
    .select("*", { count: "exact", head: true })
    .eq("is_duplicate", true)
    .gte("created_at", weekAgo);

  return NextResponse.json({
    lockouts: enrichedLockouts,
    duplicates: enrichedDuplicates,
    flagged: enrichedFlagged,
    summary: {
      activeLockouts: enrichedLockouts.length,
      duplicatesThisWeek: duplicatesThisWeek || 0,
      flaggedForReview: enrichedFlagged.length,
      totalVerifications: totalVerifications || 0,
    },
  });
}

// POST — admin actions: override, merge, review decision
export async function POST(req: NextRequest) {
  const admin = await verifyAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { action, ...params } = await req.json();
  const supabase = getAdminClient();
  const adminName = (admin as { adminName?: string }).adminName || "Admin";

  // ═══ Override lockout ═══
  if (action === "override_lockout") {
    const { lockoutId, candidateId, identityHash, reason } = params;
    if (!lockoutId || !reason) return NextResponse.json({ error: "lockoutId and reason required" }, { status: 400 });

    await supabase.from("english_test_lockouts").update({ lockout_expires_at: new Date().toISOString() }).eq("id", lockoutId);
    if (candidateId) {
      await supabase.from("candidates").update({ permanently_blocked: false, retake_available_at: null }).eq("id", candidateId);
    }

    await supabase.from("lockout_overrides").insert({
      candidate_id: candidateId || null,
      identity_hash: identityHash || null,
      overridden_by: admin.id,
      override_reason: reason,
    });

    await notifyAdmin("Lockout Override", `Lockout ${lockoutId} overridden. Reason: ${reason}`, adminName);
    return NextResponse.json({ success: true });
  }

  // ═══ Merge duplicate ═══
  if (action === "merge_duplicate") {
    const { duplicateId, originalCandidateId, duplicateCandidateId } = params;
    if (!duplicateCandidateId) return NextResponse.json({ error: "duplicateCandidateId required" }, { status: 400 });

    // Get duplicate candidate's test scores
    const { data: dupCandidate } = await supabase
      .from("candidates")
      .select("english_mc_score, english_comprehension_score, english_percentile, english_written_tier")
      .eq("id", duplicateCandidateId)
      .single();

    // If original has no scores but duplicate does, transfer
    if (originalCandidateId && dupCandidate?.english_mc_score) {
      const { data: origCandidate } = await supabase
        .from("candidates")
        .select("english_mc_score")
        .eq("id", originalCandidateId)
        .single();

      if (!origCandidate?.english_mc_score) {
        await supabase.from("candidates").update({
          english_mc_score: dupCandidate.english_mc_score,
          english_comprehension_score: dupCandidate.english_comprehension_score,
          english_percentile: dupCandidate.english_percentile,
          english_written_tier: dupCandidate.english_written_tier,
        }).eq("id", originalCandidateId);
      }
    }

    // Mark duplicate as permanently closed
    await supabase.from("candidates").update({ admin_status: "duplicate_blocked", permanently_blocked: true }).eq("id", duplicateCandidateId);

    await notifyAdmin("Account Merge", `Duplicate ${duplicateCandidateId} merged into ${originalCandidateId}. Duplicate marked as permanently closed.`, adminName);
    return NextResponse.json({ success: true });
  }

  // ═══ Review flagged identity ═══
  if (action === "review_flagged") {
    const { identityId, decision } = params; // decision: "confirm_duplicate" or "confirm_legitimate"
    if (!identityId || !decision) return NextResponse.json({ error: "identityId and decision required" }, { status: 400 });

    if (decision === "confirm_duplicate") {
      await supabase.from("verified_identities").update({
        is_duplicate: true,
        flagged_for_review: false,
        review_reason: `Confirmed duplicate by admin at ${new Date().toISOString()}`,
      }).eq("id", identityId);
    } else {
      await supabase.from("verified_identities").update({
        flagged_for_review: false,
        review_reason: `Confirmed legitimate by admin at ${new Date().toISOString()}`,
      }).eq("id", identityId);
    }

    await notifyAdmin("Flagged Review Decision", `Identity ${identityId}: ${decision}`, adminName);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
