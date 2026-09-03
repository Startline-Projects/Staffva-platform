import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { enforceRateLimit, clientIp, LIMITS } from "@/lib/rateLimit";
import { startVerification, twilioConfigured, type OtpChannel } from "@/lib/twilioVerify";
import { DIAL_CODES } from "@/lib/atlasCountries";

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// The 93 dial codes the product actually serves. Server-side because the
// client list is advisory: hand-crafted requests could otherwise reach
// premium-rate and revenue-share ranges (+882 etc.) — the raw material of
// SMS pumping. (NANP premium ranges ride in on "+1"; Twilio's Fraud Guard
// is the layer for those.)
const KNOWN_DIALS = [...new Set(Object.values(DIAL_CODES))];

/**
 * POST /api/phone/send-code
 * Body: { phone: "+639171234567", channel?: "whatsapp" | "sms" }
 * → { ok: true } | { error, code }
 *
 * Sends a Twilio Verify OTP to the signed-in user's phone, and records the
 * (user → phone) claim on their profile so verify-code only ever checks a
 * phone this account actually sent to. Four rate limits stack because each
 * guards a different victim: the account limit stops one user burning Verify
 * spend, the NUMBER limit stops the endpoint being pointed at a stranger's
 * phone, the global limit is the daily spend fuse, and the IP limit is the
 * raw ceiling — sat high enough for a BPO office behind one NAT address.
 */
export async function POST(req: NextRequest) {
  if (!twilioConfigured()) {
    return NextResponse.json(
      { error: "Phone verification isn't available yet.", code: "unconfigured" },
      { status: 503 }
    );
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Middleware exempts /api wholesale from MFA enforcement, so a session
  // that still owes its TOTP step reaches here as aal1. A half-signed-in
  // session must not modify account state.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!aal || aal.currentLevel !== aal.nextLevel) { // fail CLOSED: an unreadable AAL is not a satisfied one
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let phone: unknown, channel: unknown;
  try {
    ({ phone, channel } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request", code: "invalid_number" }, { status: 400 });
  }

  if (
    typeof phone !== "string" ||
    !/^\+[1-9]\d{6,14}$/.test(phone) ||
    !KNOWN_DIALS.some((d) => phone.startsWith(d))
  ) {
    return NextResponse.json(
      { error: "That doesn't look like a valid phone number.", code: "invalid_number" },
      { status: 400 }
    );
  }
  const otpChannel: OtpChannel = channel === "sms" ? "sms" : "whatsapp";

  const limited =
    (await enforceRateLimit(`phone-send:ip:${clientIp(req)}`, LIMITS.phoneSendIp)) ||
    (await enforceRateLimit(`phone-send:user:${user.id}`, LIMITS.phoneSendAccount)) ||
    (await enforceRateLimit(`phone-send:to:${phone}`, LIMITS.phoneSendNumber)) ||
    (await enforceRateLimit(`phone-send:global`, LIMITS.phoneSendGlobal));
  if (limited) return limited;

  const admin = getAdminClient();

  // Twilio's pending-verification state is global per (service, phone), so
  // two accounts verifying one number would burn each other's send/check
  // budgets. WRITE the claim first, THEN look for rivals: two racers both
  // check after both writes, so at least one always sees the other, and the
  // deterministic tie-break (earlier sent_at, then lower id) lets exactly
  // one proceed. Check-then-write would let both slip through the gap.
  const sentAtIso = new Date().toISOString();
  const { error: bindErr } = await admin
    .from("profiles")
    .update({ phone_pending_number: phone, phone_pending_sent_at: sentAtIso })
    .eq("id", user.id);
  if (bindErr) {
    console.error("[send-code] pending-claim write failed:", bindErr.message);
    return NextResponse.json(
      { error: "We couldn't send the code right now. Try again in a minute.", code: "send_failed" },
      { status: 502 }
    );
  }

  // Refusal is worded identically to the per-number rate limit so it isn't
  // a probe for "someone is verifying this number". Logged, because two
  // accounts on one number inside ten minutes is a fraud signal, not a
  // coincidence. Fail CLOSED: an unreachable rival check must not race on.
  const { data: rivals, error: collisionErr } = await admin
    .from("profiles")
    .select("id, phone_pending_sent_at")
    .eq("phone_pending_number", phone)
    .neq("id", user.id)
    .gt("phone_pending_sent_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
    .limit(5);
  if (collisionErr) {
    console.error("[send-code] collision check failed:", collisionErr.message);
    return NextResponse.json(
      { error: "We couldn't send the code right now. Try again in a minute.", code: "send_failed" },
      { status: 502 }
    );
  }
  const loser = (rivals || []).some(
    (r) =>
      r.phone_pending_sent_at < sentAtIso ||
      (r.phone_pending_sent_at === sentAtIso && r.id < user.id)
  );
  if (loser) {
    console.warn(
      `[send-code] cross-account pending collision on a number: users ${rivals![0].id} and ${user.id}`
    );
    return NextResponse.json(
      { error: "Too many codes sent to that number. Wait a few minutes and try again.", code: "too_many_sends" },
      { status: 429 }
    );
  }

  const result = await startVerification(phone, otpChannel);
  if (!result.ok) {
    const messages: Record<typeof result.code, string> = {
      invalid_number: "We couldn't send to that number. Double-check it and try again.",
      not_on_whatsapp: "WhatsApp isn't active on that number.",
      too_many_sends: "Too many codes sent to that number. Wait a few minutes and try again.",
      send_failed: "We couldn't send the code right now. Try again in a minute.",
    };
    const status = result.code === "too_many_sends" ? 429 : result.code === "send_failed" ? 502 : 400;
    return NextResponse.json({ error: messages[result.code], code: result.code }, { status });
  }

  return NextResponse.json({ ok: true });
}
