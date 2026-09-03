import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { enforceRateLimit, clientIp, LIMITS } from "@/lib/rateLimit";

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/** Verification links are valid this long after the email was queued. */
const LINK_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * POST /api/auth/confirm-email
 * Body: { token }
 * → { status: "verified" | "already" | "expired" | "invalid" }
 *
 * The /verify-email page calls this on load (old emailed links reach it via
 * the legacy GET's redirect). Returns a state instead of redirecting and
 * enforces the 24-hour expiry the email promises. It never returns the
 * account email — tokens leak through URLs (history, proxy logs, forwarded
 * screenshots), so this must not be a token→email oracle. The page resends
 * BY TOKEN instead.
 */
export async function POST(req: NextRequest) {
  let token: unknown;
  try {
    ({ token } = await req.json());
  } catch {
    return NextResponse.json({ status: "invalid" });
  }
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
    return NextResponse.json({ status: "invalid" });
  }

  const ipLimited = await enforceRateLimit(
    `confirm-email:ip:${clientIp(req)}`,
    LIMITS.verificationEmailIp
  );
  if (ipLimited) return ipLimited;

  const admin = getAdminClient();

  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, email_verified, email_verification_sent_at")
    .eq("email_verification_token", token)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Could not verify right now" }, { status: 500 });
  }
  if (!profile) {
    // Either a bad token, or one already consumed by a successful verify
    // (which nulls it). The page can't tell those apart and neither can we —
    // "invalid" with a sign-in hint covers both honestly.
    return NextResponse.json({ status: "invalid" });
  }

  if (profile.email_verified) {
    return NextResponse.json({ status: "already" });
  }

  const sentAt = profile.email_verification_sent_at
    ? new Date(profile.email_verification_sent_at).getTime()
    : null;
  if (sentAt && Date.now() - sentAt > LINK_TTL_MS) {
    return NextResponse.json({ status: "expired" });
  }

  const { error: updateError } = await admin
    .from("profiles")
    .update({ email_verified: true, email_verification_token: null })
    .eq("id", profile.id);

  if (updateError) {
    return NextResponse.json({ error: "Could not verify right now" }, { status: 500 });
  }

  return NextResponse.json({ status: "verified" });
}
