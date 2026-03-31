import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST — Submit application to queue (fast path — no heavy processing)
export async function POST(request: Request) {
  try {
    // Authenticate user
    const serverSupabase = await createServerClient();
    const { data: { user } } = await serverSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const { applicationData, speedTestUrl } = body;

    if (!applicationData) {
      return NextResponse.json({ error: "Missing application data" }, { status: 400 });
    }

    const supabase = getAdminClient();

    // Check for existing pending/processing queue entry for this user
    const { data: existing } = await supabase
      .from("application_queue")
      .select("id, status")
      .eq("user_id", user.id)
      .in("status", ["pending", "processing"])
      .single();

    if (existing) {
      return NextResponse.json({
        queue_id: existing.id,
        status: existing.status,
        message: "Application already in queue",
      });
    }

    // Check for existing candidate record (already processed)
    const { data: existingCandidate } = await supabase
      .from("candidates")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (existingCandidate) {
      return NextResponse.json({
        error: "Application already submitted",
        candidate_id: existingCandidate.id,
      }, { status: 409 });
    }

    // Ensure profile exists
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .single();

    if (!profile) {
      await supabase.from("profiles").upsert(
        {
          id: user.id,
          email: user.email || "",
          role: "candidate",
          full_name: applicationData.full_name || "",
        },
        { onConflict: "id", ignoreDuplicates: true }
      );
    }

    // Insert into queue — this is the ONLY database write on submission
    const { data: queueEntry, error: insertError } = await supabase
      .from("application_queue")
      .insert({
        user_id: user.id,
        status: "pending",
        application_data: {
          ...applicationData,
          speed_test_url: speedTestUrl || null,
          email: user.email,
          submitted_at: new Date().toISOString(),
        },
      })
      .select("id, created_at")
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({
      queue_id: queueEntry.id,
      status: "pending",
      message: "Application received",
      created_at: queueEntry.created_at,
    });
  } catch (err) {
    console.error("Queue submission error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET — Check queue status
export async function GET(request: Request) {
  try {
    const serverSupabase = await createServerClient();
    const { data: { user } } = await serverSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const supabase = getAdminClient();

    const { data: entry } = await supabase
      .from("application_queue")
      .select("id, status, error_text, created_at, processed_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!entry) {
      return NextResponse.json({ status: "not_found" });
    }

    // If complete, also return the candidate ID
    let candidateId: string | null = null;
    if (entry.status === "complete") {
      const { data: candidate } = await supabase
        .from("candidates")
        .select("id")
        .eq("user_id", user.id)
        .single();
      candidateId = candidate?.id || null;
    }

    return NextResponse.json({
      queue_id: entry.id,
      status: entry.status,
      error: entry.error_text,
      created_at: entry.created_at,
      processed_at: entry.processed_at,
      candidate_id: candidateId,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
