import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET — priority queue for recruiter or admin cross-recruiter view
export async function GET(req: NextRequest) {
  const supabase = getAdminClient();

  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: { user } } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ).auth.getUser(token);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "recruiter" && profile.role !== "admin" && profile.role !== "recruiting_manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const view = searchParams.get("view") || "recruiter"; // "recruiter" or "admin"
  const statusFilter = searchParams.get("status") || "all";

  // Get assignments if recruiter (recruiting_manager sees all — no scope filter)
  let assignedCategories: string[] = [];
  if (profile.role === "recruiter") {
    const { data: assignments } = await supabase
      .from("recruiter_assignments")
      .select("role_category")
      .eq("recruiter_id", user.id);
    assignedCategories = assignments?.map((a) => a.role_category) || [];
  }

  // Build query
  let query = supabase
    .from("candidates")
    .select(
      "id, full_name, display_name, email, country, role_category, hourly_rate, english_written_tier, screening_tag, screening_score, admin_status, profile_photo_url, created_at, waiting_since, assigned_recruiter, assignment_pending_review, voice_recording_1_url, voice_recording_2_url"
    );

  // Recruiter: filter by assigned categories; recruiting_manager sees all.
  // Always filter recruiters — previously the scope was skipped when
  // assignedCategories was empty, so a recruiter with no assignments received
  // the entire candidate queue with full PII. An empty .in() matches nothing.
  if (profile.role === "recruiter") {
    query = query.in("role_category", assignedCategories);
  }

  // Status filter
  if (statusFilter !== "all") {
    query = query.eq("admin_status", statusFilter);
  }

  const { data: candidates } = await query;

  if (!candidates) {
    return NextResponse.json({ candidates: [], workload: {} });
  }

  // Priority sort: assignment_pending_review first, then screening_tag, then waiting_since
  const tagOrder: Record<string, number> = { Priority: 0, Review: 1, Hold: 2 };

  const sorted = candidates.sort((a, b) => {
    // Pending routing always floats to top
    if (a.assignment_pending_review && !b.assignment_pending_review) return -1;
    if (!a.assignment_pending_review && b.assignment_pending_review) return 1;

    const aTag = tagOrder[a.screening_tag || "Review"] ?? 1;
    const bTag = tagOrder[b.screening_tag || "Review"] ?? 1;
    if (aTag !== bTag) return aTag - bTag;

    // Within same tag, longest waiting first
    const aWait = a.waiting_since ? new Date(a.waiting_since).getTime() : Date.now();
    const bWait = b.waiting_since ? new Date(b.waiting_since).getTime() : Date.now();
    return aWait - bWait; // Earlier = longer wait = first
  });

  // Calculate SLA status for each candidate
  const now = Date.now();
  const enriched = sorted.map((c) => {
    const waitMs = c.waiting_since ? now - new Date(c.waiting_since).getTime() : 0;
    const waitHours = waitMs / (1000 * 60 * 60);

    let slaStatus: "green" | "yellow" | "red" = "green";
    if (waitHours >= 48) slaStatus = "red";
    else if (waitHours >= 24) slaStatus = "yellow";

    return {
      ...c,
      sla_status: slaStatus,
      wait_hours: Math.round(waitHours * 10) / 10,
    };
  });

  // Workload summary
  const workload = {
    total: enriched.length,
    avg_wait_hours: (() => {
      const waiting = enriched.filter((c) => c.waiting_since);
      if (waiting.length === 0) return 0;
      const total = waiting.reduce((sum, c) => sum + c.wait_hours, 0);
      return Math.round((total / waiting.length) * 10) / 10;
    })(),
    red_count: enriched.filter((c) => c.sla_status === "red").length,
    yellow_count: enriched.filter((c) => c.sla_status === "yellow").length,
    green_count: enriched.filter((c) => c.sla_status === "green").length,
  };

  // For admin cross-recruiter view, group by recruiter
  let recruiterBreakdown: Record<string, { recruiter: string; count: number; red: number; avgWait: number }> | undefined;
  if (view === "admin" && profile.role === "admin") {
    const byRecruiter: Record<string, typeof enriched> = {};
    for (const c of enriched) {
      const r = c.assigned_recruiter || "Unassigned";
      if (!byRecruiter[r]) byRecruiter[r] = [];
      byRecruiter[r].push(c);
    }

    recruiterBreakdown = {};
    for (const [name, cands] of Object.entries(byRecruiter)) {
      const waiting = cands.filter((c) => c.waiting_since);
      const avgWait = waiting.length > 0
        ? Math.round((waiting.reduce((s, c) => s + c.wait_hours, 0) / waiting.length) * 10) / 10
        : 0;

      recruiterBreakdown[name] = {
        recruiter: name,
        count: cands.length,
        red: cands.filter((c) => c.sla_status === "red").length,
        avgWait,
      };
    }
  }

  return NextResponse.json({
    candidates: enriched,
    workload,
    recruiterBreakdown,
    assignedCategories,
  });
}
