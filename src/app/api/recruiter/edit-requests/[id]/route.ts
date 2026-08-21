import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET /api/recruiter/edit-requests/[id]
// Fetch one edit request. Recruiter scope — must be the assigned recruiter
// (admin/manager bypass the assignment check).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
      "id, field_name, old_value, new_value, status, decline_reason, submitted_at, resolved_at, recruiter_id, candidate_id, candidate:candidates!inner(id, display_name, profile_photo_url)"
    )
    .eq("id", id)
    .single();

  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (role === "recruiter" && data.recruiter_id !== user.id) {
    return NextResponse.json({ error: "Not assigned to you" }, { status: 403 });
  }

  return NextResponse.json({ request: data });
}
