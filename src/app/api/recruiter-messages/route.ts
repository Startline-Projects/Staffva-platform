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
  } else if (role === "recruiter" || role === "admin" || role === "recruiting_manager") {
    // Recruiter: candidateId required in query params
    if (!candidateId) {
      return NextResponse.json({ error: "candidateId required" }, { status: 400 });
    }
    // Authorization is explicit now. It used to fall out of the query filter
    // (.eq("recruiter_id", user.id) returned nothing for someone else's
    // candidate) — but that filter had to go, because it also erased a
    // candidate's history whenever they were reassigned. A staff member reads a
    // thread if they are the candidate's CURRENT assignee, or if they are an
    // admin or manager, who triage across everyone by design.
    if (role === "recruiter") {
      const { data: owned } = await admin
        .from("candidates")
        .select("id")
        .eq("id", candidateId)
        .eq("assigned_recruiter", user.id)
        .maybeSingle();
      if (!owned) {
        return NextResponse.json({ error: "Candidate not assigned to you" }, { status: 403 });
      }
    }
  } else {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch messages.
  //
  // Keyed on candidate_id ALONE, not on recruiter_id. recruiter_messages.recruiter_id
  // is frozen at insert and /api/recruiter/reassign updates only
  // candidates.assigned_recruiter, so filtering on it would erase a candidate's
  // whole history the moment they were reassigned — and it disagreed with the
  // server-rendered page, which reads the thread by candidate. No thread is
  // split today, but the reassign route is live and 39 of the notifications in
  // this system are routing notices.
  const { data: messages, error } = await admin
    .from("recruiter_messages")
    .select("id, recruiter_id, candidate_id, sender_role, body, created_at, read_at, message_type, edit_request_id, sender_profile_id")
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
    .eq("candidate_id", candidateId!)
    .eq("sender_role", readRole)
    .is("read_at", null);

  // Resolve who actually wrote each staff message. Without this the client
  // poll has no name to render and falls back to "StaffVA" — which would undo
  // 00195 sixty seconds after the page loads, since the server-rendered names
  // are replaced by the poll's payload.
  const rows = messages || [];
  const authorIds = [
    ...new Set(rows.map((m) => m.sender_profile_id).filter(Boolean)),
  ] as string[];
  const authors = new Map<string, string | null>();
  if (authorIds.length > 0) {
    const { data: profs } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", authorIds);
    for (const pr of profs || []) authors.set(pr.id, pr.full_name);
  }

  return NextResponse.json({
    messages: rows.map((m) => ({
      ...m,
      author_name: m.sender_profile_id ? authors.get(m.sender_profile_id) ?? null : null,
    })),
  });
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
  let senderProfileId: string | null = null;

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
    // recruiter_id is the THREAD owner — the specialist assigned to this
    // candidate. It stays as it was.
    recruiterId = role === "recruiter" ? user.id : candidate.assigned_recruiter;
    senderRole = "recruiter";
    // ...but the AUTHOR is whoever is actually typing. Without this an admin or
    // manager answering renders under the assigned recruiter's name and photo:
    // answer a 141-day-old message as the owner and the candidate reads a reply
    // signed by a colleague who never wrote it. 00195 enforces it.
    senderProfileId = user.id;
  } else {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: message, error } = await admin
    .from("recruiter_messages")
    .insert({
      recruiter_id: recruiterId,
      candidate_id: candidateId,
      sender_role: senderRole,
      sender_profile_id: senderProfileId,
      body: messageBody.trim(),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message });
}
