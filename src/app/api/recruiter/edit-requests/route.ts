import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET /api/recruiter/edit-requests
// Returns pending edit requests assigned to the calling recruiter.
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const role = user.app_metadata?.role;
  if (role !== "recruiter" && role !== "admin" && role !== "recruiting_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = getAdminClient();

  const { data, error } = await admin
    .from("profile_edit_requests")
    .select(
      "id, field_name, old_value, new_value, submitted_at, candidate:candidates!inner(id, display_name, profile_photo_url)"
    )
    .eq("recruiter_id", user.id)
    .eq("status", "pending")
    .order("submitted_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ requests: data ?? [] });
}
