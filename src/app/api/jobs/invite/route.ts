import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { createClient } from "@supabase/supabase-js";
import { notifyCandidate } from "@/lib/notifyCandidate";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
    // Only the two ids are read from the body now. Everything shown in the
    // email comes from the stored job row: four caller-controlled strings
    // used to be interpolated unescaped into StaffVA-branded mail, so an
    // <a href> in budget_range shipped as a link from notifications@staffva.com.
    const { job_post_id, candidate_id } = body;

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
      .select("client_id, role_category, title, hours_per_week_estimate, rate_type, hourly_rate_min, hourly_rate_max, fixed_budget")
      .eq("id", job_post_id)
      .maybeSingle();

    if (!callerClient || !jobPost || jobPost.client_id !== callerClient.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Compare-and-swap, and the match row is the authorization.
    //
    // This was a fire-and-forget update that matched zero rows — the publish
    // path never wrote job_post_matches — and then returned {success:true},
    // which the shortlist rendered as "✓ Invited". It also never validated
    // candidate_id, so a client could mail any of the 256 candidate rows,
    // including rejected and withdrawn people. Requiring an existing match row
    // makes the shortlist the only thing a client can invite from.
    const { data: claimed, error: claimErr } = await supabase
      .from("job_post_matches")
      .update({ invited_at: new Date().toISOString() })
      .eq("job_post_id", job_post_id)
      .eq("candidate_id", candidate_id)
      .is("invited_at", null)
      .select("id")
      .maybeSingle();

    if (claimErr) {
      console.error("[invite] claim failed:", claimErr.message);
      return NextResponse.json({ error: "Could not send the invite." }, { status: 500 });
    }
    if (!claimed) {
      // Either there is no match row (not shortlisted for this post) or the
      // invite already went out. Distinguish them, so the UI can too.
      const { data: existing } = await supabase
        .from("job_post_matches")
        .select("invited_at")
        .eq("job_post_id", job_post_id)
        .eq("candidate_id", candidate_id)
        .maybeSingle();
      if (!existing) {
        return NextResponse.json(
          { error: "That candidate is not shortlisted for this role." },
          { status: 404 }
        );
      }
      return NextResponse.json({ success: true, already: true });
    }

    // Get candidate email
    const { data: candidate } = await supabase
      .from("candidates")
      .select("email, display_name")
      .eq("id", candidate_id)
      .single();

    const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://staffva.com";
    const hoursLine = jobPost.hours_per_week_estimate
      ? ` for ${escapeHtml(jobPost.hours_per_week_estimate)}`
      : "";
    // budget_range is not used: it holds monthly buckets on legacy rows and
    // hourly strings on new ones, so the old copy read "$5-$12/hr per month".
    const rateLine =
      jobPost.rate_type === "fixed" && jobPost.fixed_budget != null
        ? ` at $${Number(jobPost.fixed_budget).toLocaleString()} fixed`
        : jobPost.hourly_rate_min != null && jobPost.hourly_rate_max != null
          ? ` at $${jobPost.hourly_rate_min}-$${jobPost.hourly_rate_max}/hr`
          : "";

    await notifyCandidate(supabase, {
      candidateId: candidate_id,
      category: "offer",
      title: "A client invited you to a role",
      body: `They reviewed your profile for a ${jobPost.role_category || "role"} position and want to connect.`,
      route: "/candidate/work",
      dedupeKey: `job-invite-${job_post_id}-${candidate_id}`,
    });

    // Send invite notification email via Resend
    if (candidate?.email && process.env.RESEND_API_KEY) {
      try {
        await sendEmail({
            from: "StaffVA <notifications@staffva.com>",
            to: candidate.email,
            subject: "A client wants to connect with you on StaffVA",
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #1C1B1A;">Hi ${escapeHtml(candidate.display_name || "there")},</h2>
                <p style="color: #666;">A client is looking for a <strong>${escapeHtml(jobPost.role_category || "professional")}</strong>${hoursLine}${rateLine}.</p>
                <p style="color: #666;">They reviewed your profile and would like to connect.</p>
                <p style="margin-top: 24px;">
                  <a href="${SITE}/candidate/work" style="background: #FE6E3E; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">See the role</a>
                </p>
                <p style="color: #999; font-size: 12px; margin-top: 32px;">You received this because you have an active profile on StaffVA.</p>
              </div>
            `,
          }, { recipientKind: "candidate", emailType: "job_invite" });
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
