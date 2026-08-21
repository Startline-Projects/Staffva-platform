import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET — fetch message thread between candidate and their assigned recruiter
// Query params: candidateId (required for recruiter view, optional for candidate — auto-resolved)
export async function GET(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const role = user.app_metadata?.role;
  const admin = getAdminClient();
  const { searchParams } = new URL(req.url);

  let candidateId = searchParams.get("candidateId");
  let recruiterId: string | null = null;

  if (role === "candidate") {
    // Candidate: resolve their own candidate record and assigned recruiter
    const { data: candidate } = await admin
      .from("candidates")
      .select("id, assigned_recruiter")
      .eq("user_id", user.id)
      .single();

    if (!candidate || !candidate.assigned_recruiter) {
      return NextResponse.json({ messages: [] });
    }

    candidateId = candidate.id;
    recruiterId = candidate.assigned_recruiter;
  } else if (role === "recruiter" || role === "admin" || role === "recruiting_manager") {
    // Recruiter: candidateId required in query params
    if (!candidateId) {
      return NextResponse.json({ error: "candidateId required" }, { status: 400 });
    }
    recruiterId = user.id;
  } else {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch messages
  const { data: messages, error } = await admin
    .from("recruiter_messages")
    .select("id, recruiter_id, candidate_id, sender_role, body, created_at, read_at, message_type, edit_request_id")
    .eq("recruiter_id", recruiterId!)
    .eq("candidate_id", candidateId!)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Mark unread messages as read for the current user
  const readRole = role === "candidate" ? "recruiter" : "candidate";
  await admin
    .from("recruiter_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("recruiter_id", recruiterId!)
    .eq("candidate_id", candidateId!)
    .eq("sender_role", readRole)
    .is("read_at", null);

  return NextResponse.json({ messages: messages || [] });
}

// POST — send a message
// Body: { candidateId?, body }
export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const role = user.app_metadata?.role;
  const admin = getAdminClient();
  const { candidateId: bodyCandidate, body: messageBody } = await req.json();

  if (!messageBody || typeof messageBody !== "string" || messageBody.trim().length === 0) {
    return NextResponse.json({ error: "Message body required" }, { status: 400 });
  }

  let candidateId: string | null = null;
  let recruiterId: string | null = null;
  let senderRole: string;

  if (role === "candidate") {
    // Candidate sending to their assigned recruiter
    const { data: candidate } = await admin
      .from("candidates")
      .select("id, assigned_recruiter")
      .eq("user_id", user.id)
      .single();

    if (!candidate || !candidate.assigned_recruiter) {
      return NextResponse.json({ error: "No recruiter assigned" }, { status: 400 });
    }

    candidateId = candidate.id;
    recruiterId = candidate.assigned_recruiter;
    senderRole = "candidate";
  } else if (role === "recruiter" || role === "admin" || role === "recruiting_manager") {
    // Recruiter sending to a candidate
    if (!bodyCandidate) {
      return NextResponse.json({ error: "candidateId required" }, { status: 400 });
    }

    // Verify this candidate is assigned to this recruiter
    const { data: candidate } = await admin
      .from("candidates")
      .select("id, assigned_recruiter")
      .eq("id", bodyCandidate)
      .single();

    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    if (role === "recruiter" && candidate.assigned_recruiter !== user.id) {
      return NextResponse.json({ error: "Candidate not assigned to you" }, { status: 403 });
    }

    candidateId = candidate.id;
    recruiterId = role === "recruiter" ? user.id : candidate.assigned_recruiter;
    senderRole = "recruiter";
  } else {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: message, error } = await admin
    .from("recruiter_messages")
    .insert({
      recruiter_id: recruiterId,
      candidate_id: candidateId,
      sender_role: senderRole,
      body: messageBody.trim(),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message });
}
