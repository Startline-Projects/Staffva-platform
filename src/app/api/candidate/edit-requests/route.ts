import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { labelFor, isMediaField, MEDIA_FIELD_BUCKET } from "@/lib/editFieldLabels";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Whitelist of editable fields — mirrors the CHECK constraint in migration 00081.
const EDITABLE_FIELDS = new Set([
  "bio",
  "tagline",
  "skills",
  "tools",
  "role_category",
  "country",
  // hourly_rate is deliberately NOT here. Routing it through this queue
  // promised a review that never existed — `authenticated` has held a direct
  // UPDATE grant on the column throughout, so the candidate could always
  // change it without asking. It is now honest self-service on the live
  // portal, bounded by a CHECK constraint (00186) and recorded as a status
  // event, instead of a queue that only pretended to gate it.
  "years_experience",
  "us_client_experience",
  "profile_photo_url",
  "voice_recording_1_url",
  "voice_recording_2_url",
  "work_experience",
  "video_intro_url",
]);

// GET — list the candidate's own edit requests (all statuses, newest first).
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const admin = getAdminClient();
  const { data: candidate } = await admin
    .from("candidates")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

  const { data, error } = await admin
    .from("profile_edit_requests")
    .select("id, field_name, old_value, new_value, status, decline_reason, submitted_at, resolved_at")
    .eq("candidate_id", candidate.id)
    .order("submitted_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ requests: data ?? [] });
}

// POST — submit a new edit request.
// Body: { field_name, new_value }
// For media fields, new_value is the staged storage path returned by
// /api/candidate/edit-requests/upload-staged-media.
export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { field_name?: string; new_value?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fieldName = body.field_name;
  const newValue = body.new_value;

  if (!fieldName || !EDITABLE_FIELDS.has(fieldName)) {
    return NextResponse.json({ error: "Invalid field_name" }, { status: 400 });
  }
  if (newValue === undefined || newValue === null || newValue === "") {
    return NextResponse.json({ error: "new_value required" }, { status: 400 });
  }

  const admin = getAdminClient();

  const { data: candidateRaw } = await admin
    .from("candidates")
    .select("id, assigned_recruiter, " + fieldName)
    .eq("user_id", user.id)
    .single();

  const candidate = candidateRaw as Record<string, unknown> | null;
  if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  const assignedRecruiter = candidate["assigned_recruiter"] as string | null;
  const candidateId = candidate["id"] as string;
  if (!assignedRecruiter) {
    return NextResponse.json({ error: "No recruiter assigned" }, { status: 400 });
  }

  // For media fields, validate that the staged URL points to the correct bucket/path.
  if (isMediaField(fieldName)) {
    const bucket = MEDIA_FIELD_BUCKET[fieldName];
    if (typeof newValue !== "string" || !newValue.startsWith(`${bucket}/staged/`)) {
      return NextResponse.json(
        { error: `Invalid staged path for ${fieldName} — must start with ${bucket}/staged/` },
        { status: 400 }
      );
    }
  }

  // Block duplicate pending edits on the same field.
  const { data: existing } = await admin
    .from("profile_edit_requests")
    .select("id")
    .eq("candidate_id", candidateId)
    .eq("field_name", fieldName)
    .eq("status", "pending")
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "A pending edit for this field already exists" }, { status: 409 });
  }

  // Snapshot the current live value so the TS sees "before" even if the live
  // column changes between submit and review.
  const oldValue = candidate[fieldName] ?? null;

  const { data: editRequest, error: insertErr } = await admin
    .from("profile_edit_requests")
    .insert({
      candidate_id: candidateId,
      recruiter_id: assignedRecruiter,
      field_name: fieldName,
      old_value: oldValue,
      new_value: newValue,
      status: "pending",
    })
    .select("id")
    .single();

  if (insertErr || !editRequest) {
    return NextResponse.json({ error: insertErr?.message ?? "Insert failed" }, { status: 500 });
  }

  // Post the edit-request message into the chat thread.
  const messageBody = `Profile edit requested: ${labelFor(fieldName)}`;
  const { data: chatMessage, error: messageErr } = await admin
    .from("recruiter_messages")
    .insert({
      recruiter_id: assignedRecruiter,
      candidate_id: candidateId,
      sender_role: "candidate",
      body: messageBody,
      message_type: "edit_request",
      edit_request_id: editRequest.id,
    })
    .select("id")
    .single();

  if (messageErr || !chatMessage) {
    // Best-effort rollback: delete the orphan edit request.
    await admin.from("profile_edit_requests").delete().eq("id", editRequest.id);
    return NextResponse.json({ error: messageErr?.message ?? "Message insert failed" }, { status: 500 });
  }

  await admin
    .from("profile_edit_requests")
    .update({ chat_message_id: chatMessage.id })
    .eq("id", editRequest.id);

  return NextResponse.json({ id: editRequest.id, status: "pending" });
}
