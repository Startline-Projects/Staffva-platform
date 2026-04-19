import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const ALLOWED_US_EXPERIENCE_VALUES = new Set([
  "less_than_6_months",
  "6_months_to_1_year",
  "1_to_2_years",
  "2_to_5_years",
  "5_plus_years",
  "international_only",
  "none",
  // Legacy values accepted during the migration window
  "full_time",
  "part_time_contract",
]);

/**
 * POST /api/admin/candidates/update
 * Admin-only endpoint for updating individual candidate fields. Currently
 * supports us_client_experience; extend with explicit fields as needed.
 */
export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = user?.user_metadata?.role;
  if (!user || (role !== "admin" && role !== "recruiter" && role !== "recruiting_manager")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const candidateId = body?.candidate_id;
  if (!candidateId || typeof candidateId !== "string") {
    return NextResponse.json({ error: "Missing candidate_id" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(body, "us_client_experience")) {
    const v = body.us_client_experience;
    if (v !== null && !ALLOWED_US_EXPERIENCE_VALUES.has(v)) {
      return NextResponse.json({ error: "Invalid us_client_experience value" }, { status: 400 });
    }
    updates.us_client_experience = v;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
  }

  const admin = getAdminClient();
  const { error } = await admin
    .from("candidates")
    .update(updates)
    .eq("id", candidateId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
