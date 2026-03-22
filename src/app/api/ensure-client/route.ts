import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: Request) {
  const { userId, email, fullName, companyName } = await request.json();

  if (!userId || !email) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const supabase = getAdminClient();

  // Check if client row already exists
  const { data: existing } = await supabase
    .from("clients")
    .select("id")
    .eq("user_id", userId)
    .single();

  if (existing) {
    return NextResponse.json({ ok: true, existed: true });
  }

  // Create client row using service role (bypasses RLS)
  const { error } = await supabase.from("clients").insert({
    user_id: userId,
    email,
    full_name: fullName || "",
    company_name: companyName || null,
  });

  if (error) {
    console.error("ensure-client error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, created: true });
}
