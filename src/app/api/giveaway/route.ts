import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET — Get giveaway eligibility for the logged-in candidate
export async function GET() {
  const serverSupabase = await createServerClient();
  const { data: { user } } = await serverSupabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const supabase = getAdminClient();

  const { data: candidate } = await supabase
    .from("candidates")
    .select("id, admin_status")
    .eq("user_id", user.id)
    .single();

  if (!candidate) {
    return NextResponse.json({ entry: null });
  }

  // Get or create giveaway entry
  let { data: entry } = await supabase
    .from("giveaway_entries")
    .select("*")
    .eq("candidate_id", candidate.id)
    .single();

  if (!entry) {
    // Check if application is complete
    const { data: queueEntry } = await supabase
      .from("application_queue")
      .select("status")
      .eq("user_id", user.id)
      .eq("status", "complete")
      .single();

    const appComplete = !!queueEntry;
    const profileApproved = candidate.admin_status === "approved";

    const { data: newEntry } = await supabase
      .from("giveaway_entries")
      .insert({
        candidate_id: candidate.id,
        application_complete: appComplete,
        profile_approved: profileApproved,
      })
      .select("*")
      .single();

    entry = newEntry;
  } else {
    // Sync live statuses
    const { data: queueEntry } = await supabase
      .from("application_queue")
      .select("status")
      .eq("user_id", user.id)
      .eq("status", "complete")
      .single();

    const appComplete = !!queueEntry;
    const profileApproved = candidate.admin_status === "approved";

    if (entry.application_complete !== appComplete || entry.profile_approved !== profileApproved) {
      const { data: updated } = await supabase
        .from("giveaway_entries")
        .update({
          application_complete: appComplete,
          profile_approved: profileApproved,
        })
        .eq("id", entry.id)
        .select("*")
        .single();

      entry = updated || entry;
    }
  }

  return NextResponse.json({ entry });
}
