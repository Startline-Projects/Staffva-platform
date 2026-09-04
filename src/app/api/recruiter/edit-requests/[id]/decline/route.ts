import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { labelFor, isMediaField, MEDIA_FIELD_BUCKET } from "@/lib/editFieldLabels";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST /api/recruiter/edit-requests/[id]/decline
// Body: { decline_reason: string }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const role = user.app_metadata?.role;
  if (role !== "recruiter" && role !== "admin" && role !== "recruiting_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { decline_reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const reason = (body.decline_reason ?? "").trim();
  if (reason.length === 0) {
    return NextResponse.json({ error: "decline_reason required" }, { status: 400 });
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
    return NextResponse.json({ error: `Cannot decline request with status ${editRequest.status}` }, { status: 400 });
  }

  const fieldName: string = editRequest.field_name;

  // Remove staged media file (if any) — declined edits never go live.
  if (isMediaField(fieldName) && typeof editRequest.new_value === "string") {
    const bucket = MEDIA_FIELD_BUCKET[fieldName];
    const stagedKey = editRequest.new_value.replace(`${bucket}/`, "");
    if (stagedKey) await admin.storage.from(bucket).remove([stagedKey]);
  }

  const { error: updateErr } = await admin
    .from("profile_edit_requests")
    .update({
      status: "declined",
      decline_reason: reason,
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
    })
    .eq("id", id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Append decline tag to the chat message.
  if (editRequest.chat_message_id) {
    const { data: msg } = await admin
      .from("recruiter_messages")
      .select("body")
      .eq("id", editRequest.chat_message_id)
      .single();
    if (msg) {
      await admin
        .from("recruiter_messages")
        .update({ body: `${msg.body} [Declined: ${reason}]` })
        .eq("id", editRequest.chat_message_id);
    }
  }

  // Decline email (best-effort).
  // TODO: consolidate into shared sendTransactionalEmail helper in future session.
  try {
    const { data: candidate } = await admin
      .from("candidates")
      .select("email, full_name")
      .eq("id", editRequest.candidate_id)
      .single();
    if (candidate?.email && process.env.RESEND_API_KEY) {
      const firstName = (candidate.full_name || "").split(" ")[0] || "there";
      await sendEmail({
        from: "StaffVA <notifications@staffva.com>",
        to: candidate.email,
        subject: "Your profile change needs another look",
        html: `<p>Hi ${firstName},</p><p>Your request to update your <strong>${labelFor(fieldName)}</strong> was declined.</p><p><strong>Reason:</strong> ${reason}</p><p>You can submit a new request from your profile.</p><p>— The StaffVA Team</p>`,
      }, { recipientKind: "candidate", emailType: "edit_request_declined" });
    }
  } catch (e) {
    console.error("[decline] email send failed", e);
  }

  return NextResponse.json({ id, status: "declined" });
}
