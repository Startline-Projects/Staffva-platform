import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * POST /api/candidate/video-intro
 * Body: { videoUrl, thumbnailUrl? }
 * Records the uploaded video URL and sets status to pending_review
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { videoUrl, thumbnailUrl } = await req.json();
    if (!videoUrl) return NextResponse.json({ error: "Missing videoUrl" }, { status: 400 });

    const admin = getAdminClient();

    const { data: candidate } = await admin
      .from("candidates")
      .select("id, email, display_name, full_name")
      .eq("user_id", user.id)
      .single();

    if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

    // Update candidate with video URL
    await admin.from("candidates").update({
      video_intro_url: videoUrl,
      video_intro_thumbnail_url: thumbnailUrl || null,
      video_intro_status: "pending_review",
      video_intro_submitted_at: new Date().toISOString(),
      video_intro_admin_note: null,
    }).eq("id", candidate.id);

    // Send confirmation email
    if (process.env.RESEND_API_KEY && candidate.email) {
      const firstName = (candidate.display_name || candidate.full_name || "").split(" ")[0] || "there";
      try {
        await sendEmail({
          from: "StaffVA <notifications@staffva.com>",
          to: candidate.email,
          subject: "Your video introduction is under review",
          html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
            <h2 style="color:#1C1B1A;">Video Introduction Received</h2>
            <p style="color:#444;font-size:14px;">Hi ${firstName},</p>
            <p style="color:#444;font-size:14px;">We received your video introduction and our team will review it within 24 hours. You will receive an email as soon as it is approved.</p>
            <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
          </div>`,
        });
      } catch { /* silent */ }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Video intro upload error:", error);
    return NextResponse.json({ error: "Failed to save video" }, { status: 500 });
  }
}

/**
 * GET /api/candidate/video-intro
 * Returns current video intro status for authenticated candidate
 */
export async function GET() {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const admin = getAdminClient();

    const { data: candidate } = await admin
      .from("candidates")
      .select("video_intro_url, video_intro_status, video_intro_admin_note, video_intro_submitted_at, video_intro_reviewed_at")
      .eq("user_id", user.id)
      .single();

    if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

    return NextResponse.json(candidate);
  } catch (error) {
    console.error("Video intro get error:", error);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}
