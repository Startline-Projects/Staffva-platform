// src/app/api/jobs/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import { validateDraft, type JobDraft } from "@/lib/jobDraft";
import { containsContact, maskCandidateText } from "@/lib/contactMask";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// POST — Create a job post and return matched candidates
export async function POST(req: NextRequest) {
  try {
    const supabase = getAdminClient();

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ).auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: client } = await supabase
      .from("clients")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await req.json();

    // ── Structured branch: the AI composer publishes here ──
    //
    // The draft arrives client-shaped but is NEVER trusted: it goes back
    // through validateDraft — the same clamps the model's own output passes —
    // so a hand-crafted request can publish nothing a legitimate draft could
    // not. Legacy compat fields are derived so the existing shortlist and
    // invite email keep working unchanged.
    if (body.draft && typeof body.draft === "object") {
      const checked = validateDraft(JSON.stringify(body.draft));
      if (!checked.ok) {
        return NextResponse.json(
          { error: "refusal" in checked ? checked.refusal : "Invalid job draft" },
          { status: 400 }
        );
      }
      const d: JobDraft = checked.draft;
      const startDate = ["Immediately", "Within 2 weeks", "Within a month"].includes(body.start_date)
        ? (body.start_date as string)
        : "Immediately";
      const brief = typeof body.brief === "string" ? body.brief.slice(0, 2000) : null;

      // Job posts reach every matched candidate — the same pre-hire rule as
      // messages applies: no contact details in the text. The client's raw
      // brief to the composer is deliberately NOT checked: it is never shown
      // to candidates, and "I run acme-shop.com, need a Shopify VA" is the
      // normal way to use a composer.
      const freeText = [d.title, d.summary, ...(d.responsibilities || [])].join("\n");
      if (containsContact(freeText)) {
        return NextResponse.json(
          {
            error:
              "Job posts can't include contact details — candidates apply and message you here on StaffVA, which keeps both sides protected.",
          },
          { status: 400 }
        );
      }

      const legacyBudget =
        d.rate_type === "hourly"
          ? `$${d.hourly_rate_min}-$${d.hourly_rate_max}/hr`
          : `$${d.fixed_budget} fixed`;

      const { data: jobPost, error: insertError } = await supabase
        .from("job_posts")
        .insert({
          client_id: client.id,
          role_category: d.role_category,
          title: d.title,
          summary: d.summary,
          responsibilities: d.responsibilities,
          must_have_skills: d.must_have_skills,
          nice_to_have_skills: d.nice_to_have_skills,
          rate_type: d.rate_type,
          hourly_rate_min: d.hourly_rate_min,
          hourly_rate_max: d.hourly_rate_max,
          fixed_budget: d.fixed_budget,
          duration_type: d.duration_type,
          duration_estimate: d.duration_estimate,
          experience_level: d.experience_level,
          hours_per_week_estimate: d.hours_per_week_estimate,
          ai_brief: brief,
          description: d.summary,
          hours_per_week: d.hours_per_week_estimate,
          budget_range: legacyBudget,
          start_date: startDate,
          status: "active",
          published_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }

      // The match pool is gated by THE visibility rule — the SQL function is
      // the single definition of "this candidate may see this job" (role
      // match, or a must-have skill they carry). Shortlisting anyone the rule
      // would hide makes no sense: they could never be invited.
      const availabilityFilter =
        startDate === "Immediately"
          ? ["available_now"]
          : ["available_now", "available_by_date"];

      const { data: pool } = await supabase
        .from("candidates")
        .select(
          "id, full_name, display_name, country, role_category, years_experience, hourly_rate, english_written_tier, us_client_experience, availability_status, committed_hours, total_earnings_usd, bio, profile_photo_url, skills, tools"
        )
        .eq("admin_status", "approved")
      // Overdue-unverified profiles are hidden from clients (00154).
      .or("id_verification_status.in.(passed,manual_review),id_verification_due_at.is.null,id_verification_due_at.gt." + new Date().toISOString())
        .in("availability_status", availabilityFilter);

      const visible: typeof pool = [];
      for (const c of pool || []) {
        const { data: ok } = await supabase.rpc("job_visible_to_candidate", {
          p_job_id: jobPost.id,
          p_candidate_id: c.id,
        });
        if (ok === true) visible.push(c);
      }

      const norm = (arr: unknown): string[] =>
        Array.isArray(arr) ? arr.map((x) => String(x).toLowerCase()) : [];

      const matches = visible
        .map((c) => {
          let score = 0;
          if (c.role_category?.toLowerCase() === d.role_category.toLowerCase()) score += 40;
          const candidateSkills = new Set([...norm(c.skills), ...norm(c.tools)]);
          let must = 0;
          for (const skill of d.must_have_skills) {
            if (candidateSkills.has(skill.toLowerCase())) must += 8;
          }
          score += Math.min(must, 24);
          let nice = 0;
          for (const skill of d.nice_to_have_skills) {
            if (candidateSkills.has(skill.toLowerCase())) nice += 3;
          }
          score += Math.min(nice, 9);
          if (d.rate_type === "hourly" && typeof c.hourly_rate === "number") {
            if (c.hourly_rate <= (d.hourly_rate_max as number)) score += 15;
            else if (c.hourly_rate <= (d.hourly_rate_max as number) * 1.2) score += 8;
          } else {
            score += 8;
          }
          if (c.english_written_tier === "exceptional") score += 8;
          else if (c.english_written_tier === "proficient") score += 5;
          else if (c.english_written_tier === "competent") score += 3;
          if (c.us_client_experience) score += 5;
          if (c.availability_status === "available_now") score += 4;
          return { ...maskCandidateText(c), match_score: score };
        })
        .sort((a, b) => b.match_score - a.match_score)
        .slice(0, 12);

      return NextResponse.json({ jobPost, matches });
    }

    const {
      role_category,
      custom_role_description,
      hours_per_week,
      budget_range,
      start_date,
      description,
    } = body;

    if (!role_category || !hours_per_week || !budget_range || !start_date) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (containsContact([description || "", custom_role_description || ""].join("\n"))) {
      return NextResponse.json(
        {
          error:
            "Job posts can't include contact details — candidates apply and message you here on StaffVA, which keeps both sides protected.",
        },
        { status: 400 }
      );
    }

    const { data: jobPost, error: insertError } = await supabase
      .from("job_posts")
      .insert({
        client_id: client.id,
        role_category,
        custom_role_description:
          role_category === "Other" ? custom_role_description : null,
        hours_per_week,
        budget_range,
        start_date,
        description,
        status: "active",
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      );
    }

    // --- AI Matching: score approved candidates ---

    let budgetMin = 0;
    let budgetMax = 99999;
    switch (budget_range) {
      case "Under $800":
        budgetMin = 0;
        budgetMax = 800;
        break;
      case "$800 - $1,200":
        budgetMin = 800;
        budgetMax = 1200;
        break;
      case "$1,200 - $2,000":
        budgetMin = 1200;
        budgetMax = 2000;
        break;
      case "Over $2,000":
        budgetMin = 2000;
        budgetMax = 99999;
        break;
    }

    const availabilityFilter =
      start_date === "Immediately"
        ? ["available_now"]
        : ["available_now", "available_by_date"];

    const { data: candidates } = await supabase
      .from("candidates")
      .select(
        "id, full_name, display_name, country, role_category, years_experience, hourly_rate, english_written_tier, us_client_experience, availability_status, committed_hours, total_earnings_usd, bio, profile_photo_url"
      )
      .eq("admin_status", "approved")
      // Overdue-unverified profiles are hidden from clients (00154).
      .or("id_verification_status.in.(passed,manual_review),id_verification_due_at.is.null,id_verification_due_at.gt." + new Date().toISOString())
      .in("availability_status", availabilityFilter);

    if (!candidates || candidates.length === 0) {
      return NextResponse.json({
        jobPost,
        matches: [],
        message: "No matching candidates found",
      });
    }

    // Scoring: 6 dimensions, max 90 pts total (role_match 40 + budget 15 + english_tier 15 + us_experience 10 + availability 5 + earnings_bonus 5)
    const scored = candidates.map((c) => {
      let score = 0;

      // Role match (40 points)
      if (c.role_category?.toLowerCase() === role_category.toLowerCase()) {
        score += 40;
      } else {
        const legalRoles = ["paralegal", "legal assistant", "legal secretary", "litigation support", "contract reviewer"];
        const accountingRoles = ["bookkeeper", "accounts payable specialist", "accounts receivable specialist", "payroll specialist", "tax preparer", "financial analyst"];
        const adminRoles = ["administrative assistant", "executive assistant", "virtual assistant", "office manager", "data entry specialist"];
        const medicalRoles = ["medical billing specialist", "medical administrative assistant", "insurance verification specialist", "dental office administrator"];

        const candidateRole = (c.role_category || "").toLowerCase();
        const targetRole = role_category.toLowerCase();

        const roleGroups = [legalRoles, accountingRoles, adminRoles, medicalRoles];
        for (const group of roleGroups) {
          if (
            group.some((r) => candidateRole.includes(r)) &&
            group.some((r) => targetRole.includes(r))
          ) {
            score += 20;
            break;
          }
        }
      }

      // Budget fit (15 points)
      if (c.hourly_rate >= budgetMin && c.hourly_rate <= budgetMax) {
        score += 15;
      } else if (c.hourly_rate >= budgetMin * 0.8 && c.hourly_rate <= budgetMax * 1.2) {
        score += 8;
      }

      // English tier (15 points)
      if (c.english_written_tier === "exceptional") score += 15;
      else if (c.english_written_tier === "proficient") score += 10;
      else if (c.english_written_tier === "competent") score += 5;

      // US client experience (10 points). Legacy enum values map to the closest new bucket.
      const usExpPoints: Record<string, number> = {
        "5_plus_years": 10,
        "2_to_5_years": 8,
        "1_to_2_years": 6,
        "6_months_to_1_year": 4,
        "less_than_6_months": 2,
        international_only: 1,
        none: 0,
        full_time: 10,
        part_time_contract: 6,
      };
      if (c.us_client_experience && usExpPoints[c.us_client_experience as string] !== undefined) {
        score += usExpPoints[c.us_client_experience as string];
      }

      // Availability (5 points)
      if (c.availability_status === "available_now") score += 5;
      else if (c.availability_status === "available_by_date") score += 3;

      // Verified earnings bonus (5 points)
      if (c.total_earnings_usd > 5000) score += 5;
      else if (c.total_earnings_usd > 1000) score += 3;
      else if (c.total_earnings_usd > 0) score += 1;

      return { ...maskCandidateText(c), match_score: score };
    });

    scored.sort((a, b) => b.match_score - a.match_score);
    const topMatches = scored.slice(0, 5);
    const nearMisses = scored.slice(5, 10);

    if (topMatches.length > 0) {
      const matchRows = topMatches.map((m) => ({
        job_post_id: jobPost.id,
        candidate_id: m.id,
        match_score: m.match_score,
      }));

      await supabase.from("job_post_matches").insert(matchRows);
    }

    // Feature 5: Send role match alert emails to candidates ranked 6-10
    if (nearMisses.length > 0 && process.env.RESEND_API_KEY) {
      // Get emails for near-miss candidates
      const nearMissIds = nearMisses.map((c) => c.id);
      const { data: nearMissCandidates } = await supabase
        .from("candidates")
        .select("id, email, display_name")
        .in("id", nearMissIds);

      if (nearMissCandidates) {
        for (const c of nearMissCandidates) {
          try {
            await sendEmail({
                from: "StaffVA <notifications@staffva.com>",
                to: c.email,
                subject: "A client is looking for someone like you",
                html: `
                  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
                    <h2 style="color: #1C1B1A; font-size: 18px;">Hi ${c.display_name?.split(" ")[0] || "there"},</h2>
                    <p style="color: #666; font-size: 14px; line-height: 1.6;">
                      A client recently posted a role for a <strong>${role_category}</strong> professional on StaffVA.
                    </p>
                    <p style="color: #666; font-size: 14px; line-height: 1.6;">
                      Make sure your profile is complete and your availability is up to date so you are first in line for the next opportunity.
                    </p>
                    <div style="text-align: center; margin: 28px 0;">
                      <a href="https://staffva.com/candidate/dashboard" style="display: inline-block; background: #FE6E3E; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Review my profile</a>
                    </div>
                    <p style="color: #999; font-size: 12px; border-top: 1px solid #E0E0E0; padding-top: 16px; margin-top: 32px;">
                      You received this because you have an active profile on StaffVA matching this role category.
                    </p>
                  </div>
                `,
              }, { recipientKind: "candidate", emailType: "role_match_alert" });
          } catch {
            // Silent — don't block the response
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }

    return NextResponse.json({
      jobPost,
      matches: topMatches,
    });
  } catch (err) {
    console.error("Job post error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// GET — List client's job posts
export async function GET(req: NextRequest) {
  try {
    const supabase = getAdminClient();

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
    } = await createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ).auth.getUser(token);

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: client } = await supabase
      .from("clients")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const { data: jobPosts } = await supabase
      .from("job_posts")
      .select("*")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false });

    return NextResponse.json({ jobPosts: jobPosts || [] });
  } catch (err) {
    console.error("Job posts fetch error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
