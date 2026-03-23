import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: Request) {
  const { userId, email, role, fullName, companyName } = await request.json();

  if (!userId || !email || !role) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const supabase = getAdminClient();

  // Upsert profile — create if missing, skip if exists
  const { error: profileError } = await supabase
    .from("profiles")
    .upsert(
      {
        id: userId,
        email,
        role,
        full_name: fullName || "",
      },
      { onConflict: "id", ignoreDuplicates: true }
    );

  if (profileError) {
    console.error("ensure-profile: profile upsert failed:", profileError);
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  // If client, also ensure clients row exists
  if (role === "client") {
    const { error: clientError } = await supabase
      .from("clients")
      .upsert(
        {
          user_id: userId,
          full_name: fullName || "",
          email,
          company_name: companyName || null,
        },
        { onConflict: "user_id", ignoreDuplicates: true }
      );

    if (clientError) {
      console.error("ensure-profile: client upsert failed:", clientError);
      // Non-fatal — profile was created
    }
  }

  return NextResponse.json({ ok: true });
}
