import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json([]);
  }

  const supabase = getAdminClient();

  // Search role_category and skills across approved candidates
  const { data, error } = await supabase
    .from("candidates")
    .select("role_category, skills")
    .eq("admin_status", "approved")
      // Overdue-unverified profiles are hidden from clients (00154/00155).
      .or("id_verification_status.in.(passed,manual_review),id_verification_due_at.is.null,id_verification_due_at.gt." + new Date().toISOString());

  if (error) {
    return NextResponse.json([], { status: 500 });
  }

  const lower = q.toLowerCase();
  const matchSet = new Set<string>();

  for (const c of data || []) {
    // Match role_category
    if (c.role_category && c.role_category.toLowerCase().includes(lower)) {
      matchSet.add(c.role_category);
    }
    // Match skills array (JSONB)
    if (Array.isArray(c.skills)) {
      for (const skill of c.skills) {
        if (typeof skill === "string" && skill.toLowerCase().includes(lower)) {
          matchSet.add(skill);
        }
      }
    }
    if (matchSet.size >= 6) break;
  }

  // Return up to 6 unique suggestions
  return NextResponse.json([...matchSet].slice(0, 6));
}
