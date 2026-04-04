import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * POST /api/auth/check-verification
 * Body: { userId }
 * Returns whether the user's email is verified
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();
    if (!userId) return NextResponse.json({ verified: true }); // Fail open for safety

    const admin = getAdminClient();

    const { data: profile } = await admin
      .from("profiles")
      .select("email_verified")
      .eq("id", userId)
      .single();

    if (!profile) {
      // Profile doesn't exist yet — allow through (will be created by trigger)
      return NextResponse.json({ verified: true });
    }

    return NextResponse.json({ verified: profile.email_verified !== false });
  } catch {
    // Fail open — don't block login on errors
    return NextResponse.json({ verified: true });
  }
}
