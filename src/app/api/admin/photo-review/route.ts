import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function verifyAdmin() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.user_metadata?.role === "admin" ? user : null;
}

export async function POST(req: NextRequest) {
  const admin = await verifyAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { candidateId, action, rejectionNote } = await req.json();

  if (!candidateId || !action) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const supabase = getAdminClient();

  const { data: candidate } = await supabase
    .from("candidates")
    .select("pending_photo_url, profile_photo_url, email, full_name")
    .eq("id", candidateId)
    .single();

  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  if (action === "approve") {
    // Copy pending photo to live profile photo
    await supabase
      .from("candidates")
      .update({
        profile_photo_url: candidate.pending_photo_url,
        pending_photo_url: null,
        photo_pending_review: false,
      })
      .eq("id", candidateId);

    return NextResponse.json({ success: true, action: "approved" });
  }

  if (action === "reject") {
    // Clear pending photo
    await supabase
      .from("candidates")
      .update({
        pending_photo_url: null,
        photo_pending_review: false,
      })
      .eq("id", candidateId);

    // Send rejection email
    if (process.env.RESEND_API_KEY && candidate.email) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "StaffVA <noreply@staffva.com>",
            to: candidate.email,
            subject: "Your StaffVA profile photo was not approved",
            html: `<div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
              <h2 style="color: #1c1b1a;">Hi ${candidate.full_name},</h2>
              <p style="color: #555;">The profile photo you submitted was not approved by our team.</p>
              ${rejectionNote ? `<div style="background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <p style="color: #991B1B; font-weight: 600; margin: 0 0 8px 0; font-size: 14px;">Reason:</p>
                <p style="color: #7F1D1D; margin: 0;">${rejectionNote}</p>
              </div>` : ""}
              <p style="color: #555;">Please upload a new professional photo that meets our guidelines:</p>
              <ul style="color: #555;">
                <li>Clear, well-lit headshot</li>
                <li>Professional appearance</li>
                <li>No filters or heavy editing</li>
                <li>Face clearly visible</li>
              </ul>
              <a href="https://staffva.com/candidate/me" style="display: inline-block; background: #fe6e3e; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 16px;">Update Your Photo</a>
              <p style="color: #999; margin-top: 24px; font-size: 12px;">— The StaffVA Team</p>
            </div>`,
          }),
        });
      } catch (err) {
        console.error("Failed to send photo rejection email:", err);
      }
    }

    return NextResponse.json({ success: true, action: "rejected" });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
