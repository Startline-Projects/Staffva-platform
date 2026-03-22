import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: Request) {
  const { userId, email, role, fullName } = await request.json();

  if (!userId || !email || !role) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const supabase = getAdminClient();

  // Check if profile already exists
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .single();

  if (existing) {
    return NextResponse.json({ ok: true, existed: true });
  }

  // Create profile using service role (bypasses RLS)
  const { error } = await supabase.from("profiles").insert({
    id: userId,
    email,
    role,
    full_name: fullName || "",
  });

  if (error) {
    console.error("ensure-profile error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, created: true });
}
