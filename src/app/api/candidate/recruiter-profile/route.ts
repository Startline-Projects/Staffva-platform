import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET — fetch the assigned recruiter's profile for the authenticated candidate
// Uses service role to bypass profiles RLS (candidates can only read their own profile)
export async function GET(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = getAdminClient();

  // Get this user's candidate record to find their assigned_recruiter
  const { data: candidate } = await admin
    .from("candidates")
    .select("id, assigned_recruiter")
    .eq("user_id", user.id)
    .single();

  if (!candidate || !candidate.assigned_recruiter) {
    return NextResponse.json({ recruiter_profile: null });
  }

  // assigned_recruiter may be a UUID (from recruiter_assignments webhook) or a first name
  // string (from legacy round-robin in process-application-queue). Handle both.
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    candidate.assigned_recruiter
  );

  let profile = null;
  if (isUUID) {
    const { data } = await admin
      .from("profiles")
      .select("id, full_name, calendar_link, recruiter_photo_url")
      .eq("id", candidate.assigned_recruiter)
      .single();
    profile = data;
  } else {
    // Legacy: assigned_recruiter is a first name like "Shelly" or "Jerome"
    const { data } = await admin
      .from("profiles")
      .select("id, full_name, calendar_link, recruiter_photo_url")
      .eq("role", "recruiter")
      .ilike("full_name", `${candidate.assigned_recruiter}%`)
      .limit(1)
      .maybeSingle();
    profile = data;
  }

  return NextResponse.json({ recruiter_profile: profile });
}
