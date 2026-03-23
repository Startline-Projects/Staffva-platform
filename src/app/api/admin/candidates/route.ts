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
  const search = searchParams.get("search") || "";
  const view = searchParams.get("view") || "filtered"; // "filtered" or "all"

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

// PATCH — update specific candidate fields (earnings, deactivate, etc.)
export async function PATCH(request: Request) {
  const admin = await verifyAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { candidateId, updates } = await request.json();
  if (!candidateId || !updates) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // Only allow specific fields to be updated
  const allowedFields = ["total_earnings_usd", "admin_status"];
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
