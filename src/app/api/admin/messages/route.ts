import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { loadAwaitingThreads, loadCandidateThread } from "@/lib/recruiterThread";
import { notifyCandidate } from "@/lib/notifyCandidate";

/**
 * Staff view of every candidate waiting on a reply, and the ability to answer.
 *
 * Reachable by admin AND recruiting_manager, because the manager is assigned
 * three of the nine waiting threads — holding nine of the ten unread messages —
 * and until migration 00194 could not read them at all: the old RLS policy
 * required profiles.role = 'recruiter', and the recruiter dashboard
 * short-circuits before it ever fetches threads for a manager.
 */

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function requireStaff() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const role = user.app_metadata?.role;
  if (role !== "admin" && role !== "recruiting_manager") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}

export async function GET(req: NextRequest) {
  const gate = await requireStaff();
  if (gate.error) return gate.error;

  const candidateId = req.nextUrl.searchParams.get("candidateId");
  if (candidateId) {
    const { messages, state } = await loadCandidateThread(candidateId);
    return NextResponse.json({ messages, state });
  }

  const threads = await loadAwaitingThreads();
  return NextResponse.json({ threads });
}

export async function POST(req: NextRequest) {
  const gate = await requireStaff();
  if (gate.error) return gate.error;
  const user = gate.user!;

  const body = await req.json().catch(() => ({}));
  const candidateId = typeof body.candidateId === "string" ? body.candidateId : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";

  if (!candidateId) return NextResponse.json({ error: "candidateId required" }, { status: 400 });
  if (!text) return NextResponse.json({ error: "Write something first." }, { status: 400 });
  if (text.length > 4000) {
    return NextResponse.json({ error: "Message is too long." }, { status: 400 });
  }

  const db = admin();
  const { data: candidate, error: candErr } = await db
    .from("candidates")
    .select("id, assigned_recruiter")
    .eq("id", candidateId)
    .maybeSingle();
  if (candErr) {
    console.error("[admin/messages] candidate lookup failed:", candErr.message);
    return NextResponse.json({ error: "Could not send." }, { status: 500 });
  }
  if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  if (!candidate.assigned_recruiter) {
    // The guard in 00195 requires the thread to have an owner, and a message
    // addressed to nobody would be unreadable by any staff screen.
    return NextResponse.json(
      { error: "This candidate has no assigned specialist yet." },
      { status: 409 }
    );
  }

  const { data: message, error } = await db
    .from("recruiter_messages")
    .insert({
      candidate_id: candidate.id,
      // The thread still belongs to the assigned specialist...
      recruiter_id: candidate.assigned_recruiter,
      sender_role: "recruiter",
      // ...but the message is signed by whoever actually wrote it. Without
      // this, an owner answering a 141-day-old message would appear to the
      // candidate as a reply from the absent specialist.
      sender_profile_id: user.id,
      body: text,
      message_type: "regular",
    })
    .select("id, body, created_at")
    .single();

  if (error) {
    console.error("[admin/messages] insert failed:", error.message);
    return NextResponse.json({ error: "Could not send." }, { status: 500 });
  }

  // No dedupe key: every reply is its own event.
  await notifyCandidate(db, {
    candidateId: candidate.id,
    category: "message",
    title: "New message from your StaffVA team",
    body: text.length > 120 ? text.slice(0, 117) + "…" : text,
    route: "/candidate/messages",
  });

  return NextResponse.json({ message });
}
