import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  try {
    const supabase = getAdminClient();

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ).auth.getUser(token);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { job_post_id, candidate_id, candidate_name, role_category, hours_per_week, budget_range } = body;

    if (!job_post_id || !candidate_id) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // The caller must be the client who owns this job post. Previously ANY
    // authenticated user (including a candidate) could invite an arbitrary
    // candidate to an arbitrary job post and trigger the invite email.
    const { data: callerClient } = await supabase
      .from("clients")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    const { data: jobPost } = await supabase
      .from("job_posts")
      .select("client_id")
      .eq("id", job_post_id)
      .maybeSingle();

    if (!callerClient || !jobPost || jobPost.client_id !== callerClient.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Mark as invited in job_post_matches
    await supabase
      .from("job_post_matches")
      .update({ invited_at: new Date().toISOString() })
      .eq("job_post_id", job_post_id)
      .eq("candidate_id", candidate_id);

    // Get candidate email
    const { data: candidate } = await supabase
      .from("candidates")
      .select("email, display_name")
      .eq("id", candidate_id)
      .single();

    // Send invite notification email via Resend
    if (candidate?.email && process.env.RESEND_API_KEY) {
      try {
        await sendEmail({
            from: "StaffVA <notifications@staffva.com>",
            to: candidate.email,
            subject: "A client wants to connect with you on StaffVA",
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #1C1B1A;">Hi ${candidate.display_name || candidate_name},</h2>
                <p style="color: #666;">A client is looking for a <strong>${role_category}</strong> professional for <strong>${hours_per_week}</strong> at <strong>${budget_range}</strong> per month.</p>
                <p style="color: #666;">They reviewed your profile and would like to connect.</p>
                <p style="margin-top: 24px;">
                  <a href="https://staffva.com/login" style="background: #FE6E3E; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Log in to respond</a>
                </p>
                <p style="color: #999; font-size: 12px; margin-top: 32px;">You received this because you have an active profile on StaffVA.</p>
              </div>
            `,
          });
      } catch {
        // Email send failed — don't block the invite
        console.error("Failed to send invite email");
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Invite error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
