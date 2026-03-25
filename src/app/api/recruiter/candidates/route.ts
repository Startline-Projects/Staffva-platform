import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getAdminClient();

    // Get auth token
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ).auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify user is a recruiter or admin
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || (profile.role !== "recruiter" && profile.role !== "admin")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get recruiter's assigned role categories
    const { data: assignments } = await supabase
      .from("recruiter_assignments")
      .select("role_category")
      .eq("recruiter_id", user.id);

    const assignedCategories = assignments?.map((a) => a.role_category) || [];

    // If admin, show all candidates; if recruiter, filter by assignments
    let query = supabase
      .from("candidates")
      .select(
        "id, user_id, full_name, display_name, email, country, role_category, years_experience, monthly_rate, english_written_tier, speaking_level, us_client_experience, admin_status, screening_tag, screening_score, screening_reason, availability_status, committed_hours, total_earnings_usd, profile_photo_url, bio, created_at, cheat_flag_count, assigned_recruiter"
      )
      .order("created_at", { ascending: false });

    // Recruiters only see candidates in their assigned categories
    if (profile.role === "recruiter" && assignedCategories.length > 0) {
      query = query.in("role_category", assignedCategories);
    }

    // Apply filters from query params
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const screening = searchParams.get("screening");
    const search = searchParams.get("search");

    if (status && status !== "all") {
      query = query.eq("admin_status", status);
    }

    if (screening && screening !== "all") {
      query = query.eq("screening_tag", screening);
    }

    if (search) {
      query = query.or(
        `full_name.ilike.%${search}%,display_name.ilike.%${search}%,country.ilike.%${search}%,email.ilike.%${search}%`
      );
    }

    const { data: candidates, error: fetchError } = await query;

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    return NextResponse.json({
      candidates: candidates || [],
      assignedCategories,
      role: profile.role,
    });
  } catch (err) {
    console.error("Recruiter candidates error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
