import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const ROLE_CATEGORIES = [
  "Paralegal", "Legal Assistant", "Legal Secretary", "Litigation Support", "Contract Reviewer",
  "Bookkeeper", "Accounts Payable Specialist", "Accounts Receivable Specialist", "Payroll Specialist", "Tax Preparer", "Financial Analyst",
  "Administrative Assistant", "Executive Assistant", "Virtual Assistant", "Office Manager", "Data Entry Specialist", "Transcriptionist",
  "Cold Caller", "Sales Representative", "Sales Development Representative (SDR)", "Appointment Setter", "Account Manager", "Lead Generation Specialist",
  "Social Media Manager", "Content Writer", "SEO Specialist", "Paid Ads Specialist", "Email Marketing Specialist", "CRM Manager",
  "Scheduling Coordinator", "Customer Support Representative",
  "Medical Billing Specialist", "Medical Administrative Assistant", "Insurance Verification Specialist", "Dental Office Administrator",
  "Real Estate Assistant", "Transaction Coordinator",
  "HR Assistant", "Recruitment Coordinator",
  "Graphic Designer", "Video Editor",
  "Project Manager", "Operations Assistant", "E-Commerce Manager", "Shopify Manager", "Amazon Store Manager",
];

interface ExtractedQuery {
  role_category: string;
  required_skills: string[];
  experience_level: string;
  hours_per_week: number | null;
  urgency: string;
}

function getExperienceLevel(yearsStr: string): string {
  const mapping: Record<string, string> = {
    "0-1": "entry", "1-3": "mid", "3-5": "mid", "5-10": "senior", "10+": "senior",
  };
  return mapping[yearsStr] || "mid";
}

function calculateScore(
  candidate: Record<string, unknown>,
  extracted: ExtractedQuery
): number {
  let score = 0;

  // Role match (30 points)
  const candidateRole = (candidate.role_category as string || "").toLowerCase();
  const extractedRole = (extracted.role_category || "").toLowerCase();
  if (candidateRole === extractedRole) {
    score += 30;
  } else if (candidateRole.includes(extractedRole) || extractedRole.includes(candidateRole)) {
    score += 20;
  }

  // Skills match (5 points each, max 25)
  const candidateTools = (candidate.tools as string[]) || [];
  const candidateToolsLower = candidateTools.map((t) => t.toLowerCase());
  let skillPoints = 0;
  for (const skill of extracted.required_skills || []) {
    if (candidateToolsLower.some((t) => t.includes(skill.toLowerCase()) || skill.toLowerCase().includes(t))) {
      skillPoints += 5;
    }
  }
  score += Math.min(skillPoints, 25);

  // Experience level match (20 points)
  const candidateExp = getExperienceLevel(candidate.years_experience as string || "1-3");
  if (candidateExp === extracted.experience_level) {
    score += 20;
  } else if (
    (candidateExp === "senior" && extracted.experience_level === "mid") ||
    (candidateExp === "mid" && extracted.experience_level === "entry")
  ) {
    score += 10; // overqualified is still a partial match
  }

  // Availability match (15 points)
  if (extracted.hours_per_week) {
    const committed = (candidate.committed_hours as number) || 0;
    const available = 50 - committed;
    if (available >= extracted.hours_per_week * 0.8) {
      score += 15;
    } else if (available > 0) {
      score += 7;
    }
  } else {
    score += 10; // no preference = partial credit
  }

  // English tier bonus (10 points max)
  const tier = candidate.english_written_tier as string;
  if (tier === "exceptional") score += 10;
  else if (tier === "advanced") score += 7;
  else if (tier === "professional") score += 5;

  return Math.min(score, 100);
}

export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json();
    if (!query?.trim()) {
      return NextResponse.json({ error: "Please describe what you need" }, { status: 400 });
    }

    const admin = getAdminClient();

    // Check if authenticated (optional)
    let clientId: string | null = null;
    try {
      const supabase = await createServerClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.app_metadata?.role === "client") {
        const { data: client } = await admin.from("clients").select("id").eq("user_id", user.id).single();
        clientId = client?.id || null;
      }
    } catch { /* unauthenticated — fine */ }

    // Extract structured requirements via Claude API
    let extracted: ExtractedQuery = {
      role_category: "Virtual Assistant",
      required_skills: [],
      experience_level: "mid",
      hours_per_week: null,
      urgency: "flexible",
    };

    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.ANTHROPIC_API_KEY!,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 500,
            system: `You are a talent matching engine for StaffVA, a professional marketplace. Extract structured hiring requirements from the following plain-language description. Return JSON only with these fields: role_category (one of: ${ROLE_CATEGORIES.join(", ")}), required_skills (array of strings), experience_level (entry/mid/senior), hours_per_week (number or null if not specified), urgency (immediate/flexible). Return nothing except the JSON object.`,
            messages: [{ role: "user", content: query.trim() }],
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (response.ok) {
          const data = await response.json();
          const text = data?.content?.[0]?.text || "";
          // Extract JSON from response (handle possible markdown wrapping)
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            extracted = { ...extracted, ...parsed };
          }
        }
      } catch { /* fallback to defaults */ }
    }

    // Query candidates
    const { data: candidates } = await admin
      .from("candidates")
      .select("id, display_name, country, role_category, hourly_rate, english_written_tier, availability_status, us_client_experience, bio, total_earnings_usd, committed_hours, profile_photo_url, voice_recording_1_preview_url, years_experience, tools, reputation_tier, video_intro_status")
      .eq("admin_status", "approved");

    if (!candidates || candidates.length === 0) {
      return NextResponse.json({ results: [], extracted, message: "No candidates available" });
    }

    // Score and rank
    const scored = candidates.map((c) => ({
      ...c,
      match_score: calculateScore(c, extracted),
    }));

    const results = scored
      .filter((c) => c.match_score > 50)
      .sort((a, b) => b.match_score - a.match_score)
      .slice(0, 12);

    // If too few results above 50, lower threshold
    if (results.length < 4) {
      const additional = scored
        .filter((c) => c.match_score > 30 && !results.some((r) => r.id === c.id))
        .sort((a, b) => b.match_score - a.match_score)
        .slice(0, 12 - results.length);
      results.push(...additional);
    }

    // Store query for analytics
    try {
      await admin.from("match_queries").insert({
        client_id: clientId,
        query_text: query.trim(),
        extracted_role_category: extracted.role_category,
        extracted_skills: extracted.required_skills,
        extracted_experience_level: extracted.experience_level,
        extracted_hours_preference: extracted.hours_per_week,
        results_candidate_ids: results.map((r) => r.id),
      });
    } catch { /* non-fatal */ }

    return NextResponse.json({
      results,
      extracted,
      total: results.length,
    });
  } catch (error) {
    console.error("Match API error:", error);
    return NextResponse.json({ error: "Failed to find matches" }, { status: 500 });
  }
}
