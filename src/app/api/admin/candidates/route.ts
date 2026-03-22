import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

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

// GET — list candidates for review
export async function GET(request: Request) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "pending_speaking_review";

  const supabase = getAdminClient();

  const { data: candidates } = await supabase
    .from("candidates")
    .select("*")
    .eq("admin_status", status)
    .order("created_at", { ascending: true });

  // Get cheat events for each candidate
  const candidateIds = (candidates || []).map((c) => c.id);

  const { data: testEvents } = await supabase
    .from("test_events")
    .select("*")
    .in("candidate_id", candidateIds.length > 0 ? candidateIds : ["none"]);

  // Group events by candidate
  const eventsByCandidate: Record<string, typeof testEvents> = {};
  for (const event of testEvents || []) {
    if (!eventsByCandidate[event.candidate_id]) {
      eventsByCandidate[event.candidate_id] = [];
    }
    eventsByCandidate[event.candidate_id]!.push(event);
  }

  const enriched = (candidates || []).map((c) => ({
    ...c,
    test_events: eventsByCandidate[c.id] || [],
  }));

  return NextResponse.json({ candidates: enriched });
}
