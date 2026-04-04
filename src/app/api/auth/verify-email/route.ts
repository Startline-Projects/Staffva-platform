import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * GET /api/auth/verify-email?token=xxx
 * Verifies the email token and marks user as verified
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/login?error=invalid_token", req.url));
  }

  const admin = getAdminClient();

  // Find profile with this token
  const { data: profile } = await admin
    .from("profiles")
    .select("id, role, email_verified")
    .eq("email_verification_token", token)
    .single();

  if (!profile) {
    return NextResponse.redirect(new URL("/login?error=invalid_token", req.url));
  }

  if (profile.email_verified) {
    // Already verified — redirect to login
    const redirect = profile.role === "candidate" ? "/login?verified=already" : "/login?verified=already";
    return NextResponse.redirect(new URL(redirect, req.url));
  }

  // Mark as verified
  await admin.from("profiles").update({
    email_verified: true,
    email_verification_token: null,
  }).eq("id", profile.id);

  // Redirect to login with success message
  return NextResponse.redirect(new URL("/login?verified=true", req.url));
}
