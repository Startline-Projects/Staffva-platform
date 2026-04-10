import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "recruiter-photos";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function verifyAdminOrManager(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const { data: { user } } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ).auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await adminClient()
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();
  if (!profile || !["admin", "recruiting_manager"].includes(profile.role)) return null;
  return profile as { id: string; role: string };
}

// GET — return all profiles with recruiter_photo_status = pending_review
export async function GET(req: NextRequest) {
  const reviewer = await verifyAdminOrManager(req);
  if (!reviewer) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await adminClient()
    .from("profiles")
    .select("id, full_name, role, recruiter_photo_url, recruiter_photo_pending_url, recruiter_photo_pending_uploaded_at")
    .eq("recruiter_photo_status", "pending_review")
    .order("recruiter_photo_pending_uploaded_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ queue: data || [] });
}

// POST — approve or reject a pending photo
export async function POST(req: NextRequest) {
  const reviewer = await verifyAdminOrManager(req);
  if (!reviewer) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { action, profileId, reason } = await req.json();
  if (!action || !profileId) {
    return NextResponse.json({ error: "Missing action or profileId" }, { status: 400 });
  }

  const supabase = adminClient();

  // Fetch the profile to get pending URL, name, and email
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, recruiter_photo_pending_url, recruiter_photo_status")
    .eq("id", profileId)
    .single();

  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  if (profile.recruiter_photo_status !== "pending_review") {
    return NextResponse.json({ error: "No pending photo to review" }, { status: 409 });
  }

  if (action === "approve") {
    const pendingUrl = profile.recruiter_photo_pending_url;

    // Move file in storage: pending/ → approved/
    if (pendingUrl) {
      try {
        const url = new URL(pendingUrl);
        // Path after /object/public/recruiter-photos/
        const pathMatch = url.pathname.match(/\/object\/public\/recruiter-photos\/(.+)$/);
        if (pathMatch) {
          const oldPath = pathMatch[1]; // e.g. pending/abc-123.jpg
          const newPath = oldPath.replace(/^pending\//, "approved/");
          await supabase.storage.from(BUCKET).move(oldPath, newPath);
          // Rebuild public URL with new path
          const newUrl = pendingUrl.replace(
            /\/object\/public\/recruiter-photos\/.+$/,
            `/object/public/recruiter-photos/${newPath}`
          );
          // Update profiles with the moved URL
          const { error } = await supabase
            .from("profiles")
            .update({
              recruiter_photo_url: newUrl,
              recruiter_photo_pending_url: null,
              recruiter_photo_pending_uploaded_at: null,
              recruiter_photo_status: "approved",
            })
            .eq("id", profileId);
          if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        }
      } catch {
        // If storage move fails, still approve using the pending URL as the live photo
        const { error } = await supabase
          .from("profiles")
          .update({
            recruiter_photo_url: pendingUrl,
            recruiter_photo_pending_url: null,
            recruiter_photo_pending_uploaded_at: null,
            recruiter_photo_status: "approved",
          })
          .eq("id", profileId);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else {
      const { error } = await supabase
        .from("profiles")
        .update({
          recruiter_photo_pending_url: null,
          recruiter_photo_pending_uploaded_at: null,
          recruiter_photo_status: "approved",
        })
        .eq("id", profileId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Email recruiter — fire-and-forget
    await sendPhotoDecisionEmail(
      profile.email,
      profile.full_name,
      "approved",
      null
    );

    return NextResponse.json({ success: true, action: "approved" });
  }

  if (action === "reject") {
    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return NextResponse.json({ error: "Rejection reason is required" }, { status: 400 });
    }
    if (reason.trim().length > 200) {
      return NextResponse.json({ error: "Reason must be 200 characters or fewer" }, { status: 400 });
    }

    // Delete the pending file from storage
    if (profile.recruiter_photo_pending_url) {
      try {
        const url = new URL(profile.recruiter_photo_pending_url);
        const pathMatch = url.pathname.match(/\/object\/public\/recruiter-photos\/(.+)$/);
        if (pathMatch) {
          await supabase.storage.from(BUCKET).remove([pathMatch[1]]);
        }
      } catch { /* silent — DB update must still proceed */ }
    }

    const { error } = await supabase
      .from("profiles")
      .update({
        recruiter_photo_pending_url: null,
        recruiter_photo_pending_uploaded_at: null,
        recruiter_photo_status: "rejected",
      })
      .eq("id", profileId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Email recruiter — fire-and-forget
    await sendPhotoDecisionEmail(
      profile.email,
      profile.full_name,
      "rejected",
      reason.trim()
    );

    return NextResponse.json({ success: true, action: "rejected", reason: reason.trim() });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

async function sendPhotoDecisionEmail(
  email: string,
  fullName: string | null,
  decision: "approved" | "rejected",
  reason: string | null
) {
  const RESEND = process.env.RESEND_API_KEY;
  if (!RESEND || !email) return;

  const firstName = (fullName || "").split(" ")[0] || "there";
  const wrap = (body: string) =>
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">${body}<p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p></div>`;

  const subject =
    decision === "approved"
      ? "Your profile photo is now live."
      : "Your profile photo was not approved.";

  const html =
    decision === "approved"
      ? wrap(
          `<p style="color:#444;font-size:14px;">${firstName}, your new profile photo has been approved and is now showing on your recruiter card.</p>`
        )
      : wrap(
          `<p style="color:#444;font-size:14px;">${firstName}, your submitted profile photo was not approved.</p>` +
          `<p style="color:#444;font-size:14px;"><strong>Reason:</strong> ${reason}</p>` +
          `<p style="color:#444;font-size:14px;">Please upload a new photo from your recruiter dashboard.</p>`
        );

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "StaffVA <notifications@staffva.com>",
      to: email,
      subject,
      html,
    }),
  }).catch(() => {});
}
