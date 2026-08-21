import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { Resend } from "resend";
import { labelFor, isMediaField, MEDIA_FIELD_BUCKET } from "@/lib/editFieldLabels";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Live path pattern per media field. On approval we copy staged → live,
// update the candidates column to point at the new live location, and
// delete the staged file.
function liveStoragePath(fieldName: string, candidateId: string, ext: string): string {
  const ts = Date.now();
  switch (fieldName) {
    case "profile_photo_url":
      return `${candidateId}/photo-${ts}.${ext}`;
    case "voice_recording_1_url":
      return `${candidateId}/oral-reading-${ts}.${ext}`;
    case "voice_recording_2_url":
      return `${candidateId}/open-ended-${ts}.${ext}`;
    case "video_intro_url":
      return `${candidateId}/video-${ts}.${ext}`;
    default:
      throw new Error(`Unknown media field: ${fieldName}`);
  }
}

// profile_photo_url stores a full public URL in the DB; the others store
// the storage path only. Match each field's historical convention.
function isPublicUrlField(fieldName: string): boolean {
  return fieldName === "profile_photo_url";
}

// POST /api/recruiter/edit-requests/[id]/approve
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const role = user.app_metadata?.role;
  if (role !== "recruiter" && role !== "admin" && role !== "recruiting_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = getAdminClient();

  const { data: editRequest } = await admin
    .from("profile_edit_requests")
    .select("id, candidate_id, recruiter_id, field_name, new_value, status, chat_message_id")
    .eq("id", id)
    .single();

  if (!editRequest) return NextResponse.json({ error: "Edit request not found" }, { status: 404 });
  if (role === "recruiter" && editRequest.recruiter_id !== user.id) {
    return NextResponse.json({ error: "Not assigned to you" }, { status: 403 });
  }
  if (editRequest.status !== "pending") {
    return NextResponse.json({ error: `Cannot approve request with status ${editRequest.status}` }, { status: 400 });
  }

  const fieldName: string = editRequest.field_name;
  const newValue = editRequest.new_value;

  // Compute the value to write into candidates.{fieldName}.
  let applyValue: unknown;

  if (isMediaField(fieldName)) {
    const bucket = MEDIA_FIELD_BUCKET[fieldName];
    if (typeof newValue !== "string" || !newValue.startsWith(`${bucket}/staged/`)) {
      return NextResponse.json({ error: "Invalid staged path on edit request" }, { status: 400 });
    }
    const stagedKey = newValue.replace(`${bucket}/`, ""); // e.g. "staged/uuid.png"
    const ext = stagedKey.split(".").pop() || "bin";
    const liveKey = liveStoragePath(fieldName, editRequest.candidate_id, ext);

    const { error: copyErr } = await admin.storage.from(bucket).copy(stagedKey, liveKey);
    if (copyErr) {
      return NextResponse.json({ error: `Storage copy failed: ${copyErr.message}` }, { status: 500 });
    }

    if (isPublicUrlField(fieldName)) {
      const { data: urlData } = admin.storage.from(bucket).getPublicUrl(liveKey);
      applyValue = urlData.publicUrl;
    } else {
      applyValue = liveKey;
    }

    // Best-effort staged cleanup — don't fail the approval if delete errors.
    await admin.storage.from(bucket).remove([stagedKey]);
  } else {
    // Non-media: Supabase JSONB stores the raw value; unwrap to the column type.
    // For JSONB columns (skills, tools, work_experience) pass the value as-is.
    // For scalar columns, the value comes back already unwrapped from JSONB.
    applyValue = newValue;
  }

  // Apply the edit to candidates.
  const { error: applyErr } = await admin
    .from("candidates")
    .update({ [fieldName]: applyValue })
    .eq("id", editRequest.candidate_id);
  if (applyErr) {
    return NextResponse.json({ error: `Failed to apply edit: ${applyErr.message}` }, { status: 500 });
  }

  // Mark the request approved.
  const { error: statusErr } = await admin
    .from("profile_edit_requests")
    .update({
      status: "approved",
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
    })
    .eq("id", id);
  if (statusErr) {
    return NextResponse.json({ error: statusErr.message }, { status: 500 });
  }

  // Append approval tag to the chat message.
  if (editRequest.chat_message_id) {
    const { data: msg } = await admin
      .from("recruiter_messages")
      .select("body")
      .eq("id", editRequest.chat_message_id)
      .single();
    if (msg) {
      await admin
        .from("recruiter_messages")
        .update({ body: `${msg.body} [Approved]` })
        .eq("id", editRequest.chat_message_id);
    }
  }

  // Fire approval email (best-effort — don't fail the API on email errors).
  // TODO: consolidate into shared sendTransactionalEmail helper in future session.
  try {
    const { data: candidate } = await admin
      .from("candidates")
      .select("email, full_name")
      .eq("id", editRequest.candidate_id)
      .single();
    if (candidate?.email && process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const firstName = (candidate.full_name || "").split(" ")[0] || "there";
      await resend.emails.send({
        from: "StaffVA <notifications@staffva.com>",
        to: candidate.email,
        subject: "Your profile change has been approved",
        html: `<p>Hi ${firstName},</p><p>Your request to update your <strong>${labelFor(fieldName)}</strong> has been approved. The change is now live on your profile.</p><p>— The StaffVA Team</p>`,
      });
    }
  } catch (e) {
    console.error("[approve] email send failed", e);
  }

  return NextResponse.json({ id, status: "approved" });
}
