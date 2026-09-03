import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/auth/verify-email?token=xxx — the address printed in emails sent
 * before the Atlas verify page existed. It used to verify inline with no
 * expiry, no format check and no rate limit, which quietly nullified all
 * three on the new endpoint (any "expired" token could be replayed here).
 * Now it just forwards to the one canonical implementation.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") || "";
  const dest = new URL("/verify-email", req.url);
  if (token) dest.searchParams.set("token", token);
  return NextResponse.redirect(dest);
}
