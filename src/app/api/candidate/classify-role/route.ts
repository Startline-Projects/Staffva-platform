import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ownsCandidate } from "@/lib/auth";
import { extractText } from "@/lib/anthropic";

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

const ROLE_LIST = [
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

/**
 * POST /api/candidate/classify-role
 * Background job: classifies a custom role description into the closest StaffVA category
 * Body: { candidateId, customRole }
 */
export async function POST(req: NextRequest) {
  try {
    const { candidateId, customRole } = await req.json();
    if (!candidateId || !customRole) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

    // Previously unauthenticated: anyone could spend Anthropic credits and
    // overwrite any candidate's classified role.
    if (!(await ownsCandidate(candidateId))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ classified: null, reason: "no_api_key" });
    }

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
        max_tokens: 50,
        system: `You are a role classification assistant for StaffVA, a talent marketplace. Given a custom job role description provided by a candidate, return the single closest matching role category from this list: ${ROLE_LIST.join(", ")}. Return only the role category name, nothing else.`,
        messages: [{ role: "user", content: customRole }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return NextResponse.json({ classified: null, reason: "api_error" });
    }

    const data = await response.json();
    const classified = extractText(data).trim();

    if (classified && ROLE_LIST.includes(classified)) {
      const admin = getAdminClient();
      await admin.from("candidates").update({
        classified_role_category: classified,
      }).eq("id", candidateId);

      return NextResponse.json({ classified });
    }

    // If Claude returned something not in the list, still store it
    if (classified) {
      const admin = getAdminClient();
      await admin.from("candidates").update({
        classified_role_category: classified,
      }).eq("id", candidateId);
    }

    return NextResponse.json({ classified: classified || null });
  } catch (error) {
    console.error("Role classification error:", error);
    return NextResponse.json({ classified: null, reason: "error" });
  }
}
