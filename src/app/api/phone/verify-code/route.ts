import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { enforceRateLimit, clientIp, LIMITS } from "@/lib/rateLimit";
import { checkVerification, twilioConfigured } from "@/lib/twilioVerify";

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/** Claims older than this are dead — Twilio verifications live 10 minutes. */
const CLAIM_TTL_MS = 15 * 60 * 1000;

/** The one response an unbound caller ever sees. Identical to a wrong-code
 * response on purpose: "incorrect" vs "expired" would otherwise be a live
 * oracle for whether an arbitrary phone is mid-verification right now. */
function incorrectResponse() {
  return NextResponse.json(
    { error: "Incorrect code. Check the message and try again.", code: "incorrect" },
    { status: 400 }
  );
}

/**
 * POST /api/phone/verify-code
 * Body: { phone: "+639171234567", code: "123456" }
 * → { ok: true } | { error, code }
 *
 * Checks the code with Twilio and, only on "approved", stamps the phone
 * onto the signed-in user's profile. Two gates before Twilio is even asked:
 * the caller must hold a FRESH claim on exactly this phone (written by
 * send-code), which stops any account burning a stranger's shared 5-check
 * Twilio budget or probing verification state; and the stamp itself uses
 * the service role — authenticated has no UPDATE grant on profiles, which
 * is exactly why the column can be trusted.
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

  // Same rule as send-code: an aal1 session still owing its TOTP step must
  // not modify account state through the middleware's /api exemption.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!aal || aal.currentLevel !== aal.nextLevel) { // fail CLOSED: an unreadable AAL is not a satisfied one
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let phone: unknown, code: unknown;
  try {
    ({ phone, code } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request", code: "incorrect" }, { status: 400 });
  }
  if (typeof phone !== "string" || !/^\+[1-9]\d{6,14}$/.test(phone)) {
    return NextResponse.json({ error: "Invalid phone number.", code: "incorrect" }, { status: 400 });
  }
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return NextResponse.json(
      { error: "The code is 6 digits — check the message and try again.", code: "incorrect" },
      { status: 400 }
    );
  }

  // Twilio caps checks per verification (5); these bound the cross-
  // verification loop of send → guess → resend → guess. The per-NUMBER
  // bucket is deliberately NOT here — it sits after the binding gate,
  // because a bucket any stranger can drain against a victim's number
  // would just recreate the check-DoS the gate exists to stop (same
  // lesson as verificationEmailAccount: check after the lookup).
  const limited =
    (await enforceRateLimit(`phone-check:ip:${clientIp(req)}`, LIMITS.phoneSendIp)) ||
    (await enforceRateLimit(`phone-check:user:${user.id}`, LIMITS.phoneCheckAccount));
  if (limited) return limited;

  const admin = getAdminClient();

  // The binding gate. Only the account that sent to this phone, recently,
  // may check a code for it. Fail CLOSED on a read error — an unreachable
  // gate must not wave third-party checks through to the shared budget.
  const { data: claim, error: claimErr } = await admin
    .from("profiles")
    .select("phone_pending_number, phone_pending_sent_at")
    .eq("id", user.id)
    .maybeSingle();
  if (claimErr) {
    console.error("[verify-code] claim lookup failed:", claimErr.message);
    return NextResponse.json(
      { error: "We couldn't check the code right now. Try again in a minute.", code: "check_failed" },
      { status: 502 }
    );
  }
  const claimFresh =
    claim?.phone_pending_number === phone &&
    !!claim?.phone_pending_sent_at &&
    Date.now() - new Date(claim.phone_pending_sent_at).getTime() < CLAIM_TTL_MS;
  if (!claimFresh) {
    return incorrectResponse();
  }

  // Only the claim holder ever reaches this bucket, so it bounds THEIR
  // guessing on their own number — it cannot be drained by a third party.
  const numberLimited = await enforceRateLimit(`phone-check:to:${phone}`, LIMITS.phoneCheckNumber);
  if (numberLimited) return numberLimited;

  const result = await checkVerification(phone, code);
  if (!result.ok) {
    if (result.code === "incorrect") return incorrectResponse();
    const messages: Record<Exclude<typeof result.code, "incorrect">, string> = {
      expired: "That code expired. Request a new one.",
      too_many_checks: "Too many incorrect attempts. Request a new code.",
      check_failed: "We couldn't check the code right now. Try again in a minute.",
    };
    const status = result.code === "too_many_checks" ? 429 : result.code === "check_failed" ? 502 : 400;
    return NextResponse.json({ error: messages[result.code], code: result.code }, { status });
  }

  const { error } = await admin
    .from("profiles")
    .update({
      phone_number: phone,
      phone_verified_at: new Date().toISOString(),
      phone_pending_number: null,
      phone_pending_sent_at: null,
    })
    .eq("id", user.id);

  if (error) {
    // 23505 = the partial unique index: this number is already VERIFIED on
    // another account. The code was right, so say what actually blocks them.
    if (error.code === "23505") {
      return NextResponse.json(
        {
          error:
            "This number is already verified on another StaffVA account. Use a different number, or contact support@staffva.com.",
          code: "phone_in_use",
        },
        { status: 409 }
      );
    }
    console.error("[verify-code] profile stamp failed:", error.message);
    return NextResponse.json(
      { error: "The code was correct but we couldn't save it. Try again.", code: "check_failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
