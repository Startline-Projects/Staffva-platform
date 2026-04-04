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

  if (!profile || (profile.role !== "recruiter" && profile.role !== "admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const view = searchParams.get("view") || "recruiter"; // "recruiter" or "admin"
  const statusFilter = searchParams.get("status") || "all";

  // Get assignments if recruiter
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
      "id, full_name, display_name, email, country, role_category, hourly_rate, english_written_tier, speaking_level, screening_tag, screening_score, admin_status, profile_photo_url, created_at, waiting_since, second_interview_status, second_interview_scheduled_at, assigned_recruiter, voice_recording_1_url, voice_recording_2_url"
    );

  // Recruiter: filter by assigned categories
  if (profile.role === "recruiter" && assignedCategories.length > 0) {
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

  // Priority sort: screening_tag Priority first, then by waiting_since ascending (longest wait first)
  const tagOrder: Record<string, number> = { Priority: 0, Review: 1, Hold: 2 };

  const sorted = candidates.sort((a, b) => {
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
    pending_second: enriched.filter((c) => c.second_interview_status === "pending" || c.second_interview_status === "none").length,
    scheduled: enriched.filter((c) => c.second_interview_status === "scheduled").length,
    completed_this_week: (() => {
      const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
      return enriched.filter((c) =>
        c.second_interview_status === "completed" &&
        c.second_interview_scheduled_at &&
        c.second_interview_scheduled_at > weekAgo
      ).length;
    })(),
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

// POST — Schedule interview
export async function POST(req: NextRequest) {
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
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "recruiter" && profile.role !== "admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { candidateId, scheduledDate, scheduledTime } = await req.json();

  if (!candidateId || !scheduledDate || !scheduledTime) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // Get candidate info
  const { data: candidate } = await supabase
    .from("candidates")
    .select("email, display_name, full_name, role_category")
    .eq("id", candidateId)
    .single();

  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  const scheduledAt = new Date(`${scheduledDate}T${scheduledTime}:00Z`).toISOString();

  // Update candidate
  await supabase
    .from("candidates")
    .update({
      second_interview_status: "scheduled",
      second_interview_scheduled_at: scheduledAt,
    })
    .eq("id", candidateId);

  // Send calendar invite email via Resend
  if (process.env.RESEND_API_KEY) {
    const formattedDate = new Date(scheduledAt).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const formattedTime = new Date(scheduledAt).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });

    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "StaffVA <notifications@staffva.com>",
          to: candidate.email,
          subject: `Interview Scheduled — ${formattedDate} at ${formattedTime}`,
          html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
            <h2 style="color:#1C1B1A;">Your Interview is Scheduled</h2>
            <p style="color:#444;font-size:14px;">Hi ${candidate.display_name?.split(" ")[0] || candidate.full_name?.split(" ")[0] || "there"},</p>
            <p style="color:#444;font-size:14px;line-height:1.6;">Your second interview with StaffVA has been scheduled.</p>
            <div style="background:#f9f9f9;border:1px solid #e0e0e0;border-radius:8px;padding:16px;margin:16px 0;">
              <p style="margin:0 0 8px;font-size:14px;color:#1C1B1A;"><strong>Date:</strong> ${formattedDate}</p>
              <p style="margin:0 0 8px;font-size:14px;color:#1C1B1A;"><strong>Time:</strong> ${formattedTime}</p>
              <p style="margin:0;font-size:14px;color:#1C1B1A;"><strong>Interviewer:</strong> ${profile.full_name || "StaffVA Team"}</p>
            </div>
            <p style="color:#444;font-size:14px;line-height:1.6;">Please ensure you are in a quiet environment with a stable internet connection. The interview will last approximately 20 minutes.</p>
            <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
          </div>`,
        }),
      });
    } catch { /* silent */ }
  }

  // Trigger 6: Second interview scheduled email
  try {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";
    fetch(`${siteUrl}/api/candidate-emails`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateId,
        emailType: "second_interview_scheduled",
        data: {
          date: new Date(scheduledAt).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
          time: new Date(scheduledAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" }),
        },
      }),
    }).catch(() => {});
  } catch { /* non-fatal */ }

  return NextResponse.json({ success: true, scheduledAt });
}
