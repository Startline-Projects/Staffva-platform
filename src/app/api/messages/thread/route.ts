import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

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
  const role = user.user_metadata?.role;

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

  // Get names for header
  const { data: clientData } = await admin
    .from("clients")
    .select("full_name")
    .eq("id", clientRecordId)
    .single();

  const { data: candidateData } = await admin
    .from("candidates")
    .select("display_name")
    .eq("id", candidateRecordId)
    .single();

  return NextResponse.json({
    messages: messages || [],
    clientName: clientData?.full_name || "Client",
    candidateName: candidateData?.display_name || "Candidate",
  });
}
