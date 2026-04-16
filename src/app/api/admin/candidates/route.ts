import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { assertRecruiterScope } from "@/lib/recruiterScope";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function verifyAdmin() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.user_metadata?.role === "admin" ? user : null;
}

async function verifyAdminOrRecruiter() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = user?.user_metadata?.role;
  if (role !== "admin" && role !== "recruiter" && role !== "recruiting_manager") return null;
  return user;
}

// GET — list candidates for review
export async function GET(request: Request) {
  const admin = await verifyAdminOrRecruiter();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view") || "filtered"; // "filtered" or "all"
  const status = searchParams.get("status") || (view === "all" ? "all" : "active");
  const search = searchParams.get("search") || "";

  const supabase = getAdminClient();

  let query = supabase
    .from("candidates")
    .select("*")
    .order("created_at", { ascending: false });

  // Apply status filter unless viewing all
  if (view === "all" && status !== "all") {
    query = query.eq("admin_status", status);
  } else if (view !== "all") {
    query = query.eq("admin_status", status);
  }

  // Apply search
  if (search.trim()) {
    query = query.or(`full_name.ilike.%${search}%,country.ilike.%${search}%,email.ilike.%${search}%`);
  }

  const { data: candidates } = await query;

  // Get cheat events and second interview scores for each candidate
  const candidateIds = (candidates || []).map((c) => c.id);
  const safeIds = candidateIds.length > 0 ? candidateIds : ["none"];

  const [{ data: testEvents }, { data: interviews }] = await Promise.all([
    supabase
      .from("test_events")
      .select("*")
      .in("candidate_id", safeIds),
    supabase
      .from("candidate_interviews")
      .select("candidate_id, communication_score, demeanor_score, role_knowledge_score, conducted_at")
      .eq("interview_number", 2)
      .eq("status", "completed")
      .in("candidate_id", safeIds)
      .order("conducted_at", { ascending: false }),
  ]);

  // Group events by candidate
  const eventsByCandidate: Record<string, typeof testEvents> = {};
  for (const event of testEvents || []) {
    if (!eventsByCandidate[event.candidate_id]) {
      eventsByCandidate[event.candidate_id] = [];
    }
    eventsByCandidate[event.candidate_id]!.push(event);
  }

  // Keep only the most recent interview per candidate
  const interviewByCandidate: Record<string, { communication_score: number | null; demeanor_score: number | null; role_knowledge_score: number | null }> = {};
  for (const iv of interviews || []) {
    if (!interviewByCandidate[iv.candidate_id]) {
      interviewByCandidate[iv.candidate_id] = iv;
    }
  }

  const enriched = (candidates || []).map((c) => {
    const iv = interviewByCandidate[c.id];
    return {
      ...c,
      test_events: eventsByCandidate[c.id] || [],
      second_interview_communication_score: iv?.communication_score ?? null,
      second_interview_demeanor_score: iv?.demeanor_score ?? null,
      second_interview_role_knowledge_score: iv?.role_knowledge_score ?? null,
    };
  });

  return NextResponse.json({ candidates: enriched });
}

// PATCH — update specific candidate fields (earnings, deactivate, etc.)
export async function PATCH(request: Request) {
  const caller = await verifyAdminOrRecruiter();
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const callerRole = caller.user_metadata?.role;

  const body = await request.json();
  const candidateId = body.candidateId;
  const updates = body.updates || {};

  // Accept top-level assigned_recruiter / assignment_pending_review (admin routing UI sends them outside updates)
  if (body.assigned_recruiter !== undefined) updates.assigned_recruiter = body.assigned_recruiter;
  if (body.assignment_pending_review !== undefined) updates.assignment_pending_review = body.assignment_pending_review;

  if (!candidateId || Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // Scope enforcement: recruiters may only act on candidates in their assigned categories
  if (callerRole === "recruiter") {
    const scopeError = await assertRecruiterScope(caller.id, candidateId);
    if (scopeError) {
      return NextResponse.json({ error: scopeError.error }, { status: scopeError.status });
    }
  }

  // Recruiters may only edit total_earnings_usd; admins and recruiting_manager may edit all allowed fields
  const allowedFields =
    callerRole === "admin" || callerRole === "recruiting_manager"
      ? ["total_earnings_usd", "admin_status", "assigned_recruiter", "assignment_pending_review"]
      : ["total_earnings_usd"];
  const safeUpdates: Record<string, unknown> = {};
  for (const key of Object.keys(updates)) {
    if (allowedFields.includes(key)) {
      safeUpdates[key] = updates[key];
    }
  }

  if (Object.keys(safeUpdates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const supabase = getAdminClient();
  const { error } = await supabase
    .from("candidates")
    .update(safeUpdates)
    .eq("id", candidateId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
