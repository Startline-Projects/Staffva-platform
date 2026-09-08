import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { contactSafeClientName } from "@/lib/contactSafeName";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET — get all messages in a thread
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const threadId = searchParams.get("threadId");

  if (!threadId) {
    return NextResponse.json({ error: "threadId required" }, { status: 400 });
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = getAdminClient();
  const role = user.app_metadata?.role;

  // Verify user belongs to this thread
  const [clientRecordId, candidateRecordId] = threadId.split(":");

  if (role === "client") {
    const { data: client } = await admin
      .from("clients")
      .select("id")
      .eq("user_id", user.id)
      .single();
    if (!client || client.id !== clientRecordId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
  } else if (role === "candidate") {
    const { data: candidate } = await admin
      .from("candidates")
      .select("id")
      .eq("user_id", user.id)
      .single();
    if (!candidate || candidate.id !== candidateRecordId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
  } else {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // Fetch messages
  const { data: messages } = await admin
    .from("messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  // Mark messages as read (ones sent TO this user)
  if (messages && messages.length > 0) {
    const unreadIds = messages
      .filter((m) => m.sender_type !== role && !m.read_at)
      .map((m) => m.id);

    if (unreadIds.length > 0) {
      await admin
        .from("messages")
        .update({ read_at: new Date().toISOString() })
        .in("id", unreadIds);
    }
  }

  // A client asking about a pair with NO thread is previewing a conversation
  // they may be about to start — run the same initiation gate the send does.
  // Without this, ?threadId=<own_id>:<any-uuid> resolved display names for
  // rejected and mid-application candidates: a name oracle over people who
  // never agreed to be contactable.
  if ((!messages || messages.length === 0) && role === "client") {
    const [{ data: target }, { data: pairEngagement }] = await Promise.all([
      admin
        .from("candidates")
        .select("admin_status")
        .eq("id", candidateRecordId)
        .maybeSingle(),
      admin
        .from("engagements")
        .select("id")
        .eq("client_id", clientRecordId)
        .eq("candidate_id", candidateRecordId)
        .limit(1)
        .maybeSingle(),
    ]);
    if (!target || (target.admin_status !== "approved" && !pairEngagement)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  // Get names for header
  const { data: clientData } = await admin
    .from("clients")
    .select("full_name, company_name")
    .eq("id", clientRecordId)
    .single();

  const { data: candidateData } = await admin
    .from("candidates")
    .select("display_name, admin_status, permanently_blocked, id_verification_status, id_verification_due_at")
    .eq("id", candidateRecordId)
    .single();

  // Can a CLIENT still open this candidate's profile, book them, or send them
  // an offer? Messaging deliberately outlives approval (see the comment in
  // POST /api/messages — a candidate re-sitting the English test must not have
  // a conversation cut off mid-sentence), but /candidate/[id] and
  // /hire/[id]/offer both refuse anyone who is not currently listed. Without
  // this flag the thread header drew three buttons that all dead-end on
  // "Profile Not Found" in exactly the state messaging exists to preserve.
  const candidateReachable =
    !!candidateData &&
    candidateData.admin_status === "approved" &&
    !candidateData.permanently_blocked &&
    (candidateData.id_verification_status === "passed" ||
      !candidateData.id_verification_due_at ||
      new Date(candidateData.id_verification_due_at).getTime() > Date.now());

  // The unlock moment, for the thread's system card: a fully executed
  // contract is exactly when the send-side contact filter stops applying, so
  // the card the UI renders at this timestamp states a rule the API actually
  // enforces. DERIVED at read time from the same table the filter checks —
  // no stored system row that could drift from the truth.
  const { data: executedRows } = await admin
    .from("engagement_contracts")
    .select("client_signed_at, candidate_signed_at, created_at, engagements!inner(client_id, candidate_id)")
    .eq("engagements.client_id", clientRecordId)
    .eq("engagements.candidate_id", candidateRecordId)
    .eq("status", "fully_executed");
  // Per row the executed moment is the LATER signature; legacy rows with null
  // signature timestamps still count (status says executed, and the send-side
  // filter keys on status alone — a null date must not render "locked" copy
  // over an unlocked thread), approximated by created_at. Across rows, the
  // EARLIEST executed moment is when the unlock first happened.
  const moments = (executedRows ?? []).map((r) => {
    const later =
      r.client_signed_at && r.candidate_signed_at
        ? (r.client_signed_at > r.candidate_signed_at ? r.client_signed_at : r.candidate_signed_at)
        : r.client_signed_at ?? r.candidate_signed_at ?? r.created_at;
    return later as string;
  });
  const contractExecutedAt = moments.length ? moments.sort()[0] : null;

  return NextResponse.json({
    messages: messages || [],
    clientName: contactSafeClientName(clientData?.company_name, clientData?.full_name),
    candidateName: candidateData?.display_name || "Candidate",
    candidateReachable,
    contractExecutedAt,
  });
}
