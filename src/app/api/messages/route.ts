import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// GET — list threads for current user
export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const role = user.user_metadata?.role;
  const admin = getAdminClient();

  // Get the user's client or candidate record
  let userRecordId: string | null = null;

  if (role === "client") {
    const { data } = await admin
      .from("clients")
      .select("id")
      .eq("user_id", user.id)
      .single();
    userRecordId = data?.id || null;
  } else if (role === "candidate") {
    const { data } = await admin
      .from("candidates")
      .select("id")
      .eq("user_id", user.id)
      .single();
    userRecordId = data?.id || null;
  }

  if (!userRecordId) {
    return NextResponse.json({ threads: [] });
  }

  // Get all distinct threads for this user
  const column = role === "client" ? "client_id" : "candidate_id";

  const { data: messages } = await admin
    .from("messages")
    .select("*")
    .eq(column, userRecordId)
    .order("created_at", { ascending: false });

  if (!messages || messages.length === 0) {
    return NextResponse.json({ threads: [] });
  }

  // Group by thread_id, get latest message and unread count per thread
  const threadMap = new Map<
    string,
    {
      thread_id: string;
      latest_message: typeof messages[0];
      unread_count: number;
      other_party_id: string;
    }
  >();

  for (const msg of messages) {
    if (!threadMap.has(msg.thread_id)) {
      threadMap.set(msg.thread_id, {
        thread_id: msg.thread_id,
        latest_message: msg,
        unread_count: 0,
        other_party_id:
          role === "client" ? msg.candidate_id : msg.client_id,
      });
    }
    // Count unread messages sent TO this user
    if (msg.sender_type !== role && !msg.read_at) {
      const thread = threadMap.get(msg.thread_id)!;
      thread.unread_count++;
    }
  }

  // Resolve names for the other party
  const threads = Array.from(threadMap.values());
  const otherIds = [...new Set(threads.map((t) => t.other_party_id))];

  let namesMap: Record<string, string> = {};
  if (role === "client") {
    // Show candidate display_name (first + last initial) to clients
    const { data } = await admin
      .from("candidates")
      .select("id, display_name")
      .in("id", otherIds);
    if (data) {
      namesMap = Object.fromEntries(data.map((d) => [d.id, d.display_name]));
    }
  } else {
    const { data } = await admin
      .from("clients")
      .select("id, full_name")
      .in("id", otherIds);
    if (data) {
      namesMap = Object.fromEntries(data.map((d) => [d.id, d.full_name]));
    }
  }

  const enrichedThreads = threads.map((t) => ({
    ...t,
    other_party_name: namesMap[t.other_party_id] || "Unknown",
  }));

  return NextResponse.json({ threads: enrichedThreads, role });
}

// POST — send a message
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { candidateId, clientId, body } = await request.json();
  const role = user.user_metadata?.role;

  if (!body?.trim()) {
    return NextResponse.json({ error: "Message body required" }, { status: 400 });
  }

  const admin = getAdminClient();

  // Validate sender
  let senderId: string;
  if (role === "client") {
    const { data: client } = await admin
      .from("clients")
      .select("id, subscription_status")
      .eq("user_id", user.id)
      .single();

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (client.subscription_status !== "active") {
      return NextResponse.json(
        { error: "Active subscription required" },
        { status: 403 }
      );
    }
    senderId = client.id;
  } else if (role === "candidate") {
    const { data: candidate } = await admin
      .from("candidates")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }
    senderId = candidate.id;
  } else {
    return NextResponse.json({ error: "Invalid role" }, { status: 403 });
  }

  // Check if there's an active engagement (contract in place)
  const { data: activeEngagement } = await admin
    .from("engagements")
    .select("id")
    .eq("client_id", clientId)
    .eq("candidate_id", candidateId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  // If no active engagement, filter contact information
  if (!activeEngagement) {
    const contactPatterns = [
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i, // email
      /\+?\d{1,4}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{1,4}[\s.-]?\d{1,9}/i, // phone
      /(?:instagram|ig)\s*[:\-@]\s*\S+/i, // instagram
      /@[a-zA-Z0-9._]{2,30}/i, // social handles
      /whatsapp/i, // whatsapp
      /linkedin\.com/i, // linkedin
      /facebook\.com|fb\.com/i, // facebook
      /t\.me\//i, // telegram
      /twitter\.com|x\.com/i, // twitter/x
      /discord/i, // discord
      /skype/i, // skype
      /viber/i, // viber
      /signal/i, // signal app
    ];

    const trimmedBody = body.trim();
    const matchedPattern = contactPatterns.find((p) => p.test(trimmedBody));

    if (matchedPattern) {
      // Log the blocked attempt
      const recipientId = role === "client" ? candidateId : clientId;
      try {
        await admin.from("message_blocks").insert({
          sender_id: senderId,
          recipient_id: recipientId,
          message_preview: trimmedBody.substring(0, 50),
          block_reason: "contact_info_detected",
        });
      } catch { /* silent */ }

      return NextResponse.json({
        error: "Contact information cannot be shared before a contract is in place. This keeps both parties protected.",
      }, { status: 400 });
    }
  }

  const threadId = `${clientId}:${candidateId}`;

  const { data: message, error } = await admin
    .from("messages")
    .insert({
      thread_id: threadId,
      client_id: clientId,
      candidate_id: candidateId,
      sender_type: role,
      sender_id: senderId,
      body: body.trim(),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message });
}
