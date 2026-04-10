import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const BUCKET = "recruiter-photos";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function getRecruiterProfile(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const { data: { user } } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ).auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await adminClient()
    .from("profiles")
    .select("id, role, full_name, recruiter_photo_url, recruiter_photo_pending_url, recruiter_photo_status")
    .eq("id", user.id)
    .single();
  if (!profile || !["recruiter", "recruiting_manager", "admin"].includes(profile.role)) return null;
  return profile as {
    id: string;
    role: string;
    full_name: string | null;
    recruiter_photo_url: string | null;
    recruiter_photo_pending_url: string | null;
    recruiter_photo_status: string | null;
  };
}

// GET — return current photo status for the authenticated recruiter
export async function GET(req: NextRequest) {
  const profile = await getRecruiterProfile(req);
  if (!profile) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json({
    recruiter_photo_url: profile.recruiter_photo_url,
    recruiter_photo_pending_url: profile.recruiter_photo_pending_url,
    recruiter_photo_status: profile.recruiter_photo_status,
  });
}

// POST — upload a new pending photo
export async function POST(req: NextRequest) {
  const profile = await getRecruiterProfile(req);
  if (!profile) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Block if already pending review
  if (profile.recruiter_photo_status === "pending_review") {
    return NextResponse.json({ error: "A photo is already pending review." }, { status: 409 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  // Validate type
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Only JPG, PNG, and WEBP files are allowed." }, { status: 400 });
  }

  // Validate size
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File must be 5 MB or smaller." }, { status: 400 });
  }

  const ext = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
  const storagePath = `pending/${profile.id}-${Date.now()}.${ext}`;

  const supabase = adminClient();
  const arrayBuffer = await file.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, arrayBuffer, { contentType: file.type, upsert: false });

  if (uploadError) {
    return NextResponse.json({ error: `Storage upload failed: ${uploadError.message}` }, { status: 500 });
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  const pendingUrl = urlData.publicUrl;
  const now = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      recruiter_photo_pending_url: pendingUrl,
      recruiter_photo_status: "pending_review",
      recruiter_photo_pending_uploaded_at: now,
    })
    .eq("id", profile.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Notify all admins and recruiting managers — fire-and-forget
  const recruiterName = profile.full_name || "A recruiter";
  const approvalLink = "/admin/candidates?tab=recruiter-photos";

  try {
    const { data: reviewers } = await supabase
      .from("profiles")
      .select("id, email, full_name")
      .in("role", ["admin", "recruiting_manager"]);

    if (reviewers && reviewers.length > 0) {
      // In-platform notifications
      await supabase.from("recruiter_notifications").insert(
        reviewers.map((r) => ({
          recruiter_id: r.id,
          message: `${recruiterName} has uploaded a new profile photo pending your approval.`,
          link: approvalLink,
          priority: "normal",
        }))
      );

      // Resend emails
      const RESEND = process.env.RESEND_API_KEY;
      if (RESEND) {
        const wrap = (body: string) =>
          `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">${body}<p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p></div>`;

        await Promise.allSettled(
          reviewers.map((r) =>
            fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${RESEND}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from: "StaffVA <notifications@staffva.com>",
                to: r.email,
                subject: "Recruiter photo pending approval.",
                html: wrap(
                  `<p style="color:#444;font-size:14px;"><strong>${recruiterName}</strong> has submitted a new profile photo for their recruiter card. Review and approve or reject it in the admin panel.</p>` +
                  `<a href="${process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com"}${approvalLink}" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Review Photo</a>`
                ),
              }),
            }).catch(() => {})
          )
        );
      }
    }
  } catch { /* notification failure must not block the upload response */ }

  return NextResponse.json({
    recruiter_photo_pending_url: pendingUrl,
    recruiter_photo_status: "pending_review",
  });
}
