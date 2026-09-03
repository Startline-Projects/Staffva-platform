/**
 * Twilio Verify, by hand.
 *
 * The Verify service holds all OTP state — codes, expiry (10 min), its own
 * per-number send/check caps — so nothing about a pending verification is
 * stored in our database. We only write to profiles after Twilio says
 * "approved". Raw fetch instead of the twilio npm package: two endpoints do
 * not justify a 3MB dependency, and the build-verification gotcha (no env at
 * build time) rules out module-scope client construction anyway.
 *
 * All three env vars or nothing: a half-configured Twilio is treated as
 * unconfigured so the dashboard keeps the step waived instead of offering a
 * button that 500s.
 */

const BASE = "https://verify.twilio.com/v2/Services";

export type OtpChannel = "whatsapp" | "sms";

export type SendResult =
  | { ok: true }
  | { ok: false; code: "invalid_number" | "not_on_whatsapp" | "too_many_sends" | "send_failed" };

export type CheckResult =
  | { ok: true }
  | { ok: false; code: "incorrect" | "expired" | "too_many_checks" | "check_failed" };

export function twilioConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_VERIFY_SERVICE_SID
  );
}

function authHeader(): string {
  const raw = `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

async function twilioPost(
  path: string,
  body: Record<string, string>
): Promise<{ status: number; json: { status?: string; code?: number; message?: string } }> {
  const res = await fetch(`${BASE}/${process.env.TWILIO_VERIFY_SERVICE_SID}/${path}`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
    // A Twilio stall must not pin the route for the platform's whole
    // function limit — fail in 15s and let the user retry.
    signal: AbortSignal.timeout(15_000),
  });
  let json: { status?: string; code?: number; message?: string } = {};
  try {
    json = await res.json();
  } catch {
    // Non-JSON body (gateway error page). status alone decides below.
  }
  return { status: res.status, json };
}

/** Ask Twilio to deliver a 6-digit code to `phone` over `channel`. */
export async function startVerification(phone: string, channel: OtpChannel): Promise<SendResult> {
  let status: number, json: { status?: string; code?: number; message?: string };
  try {
    ({ status, json } = await twilioPost("Verifications", { To: phone, Channel: channel }));
  } catch (err) {
    console.error("[twilio-verify] send unreachable:", err);
    return { ok: false, code: "send_failed" };
  }

  if (status >= 200 && status < 300) return { ok: true };

  // Twilio's error codes, mapped only where the UI can do something
  // distinct with them. Everything else is a generic failure on purpose.
  switch (json.code) {
    case 60200: // invalid To parameter
    case 21211: // invalid phone number
    case 60205: // SMS not supported by this number (landline)
      return { ok: false, code: "invalid_number" };
    case 63003: // channel could not find the address — no WhatsApp on it
      return { ok: false, code: "not_on_whatsapp" };
    case 60203: // max send attempts reached for this number
      return { ok: false, code: "too_many_sends" };
    // 20429 (account-wide Twilio throttle) deliberately falls through to the
    // generic branch: it is OUR account being throttled, not this user's
    // number, and blaming their number would be false — worse, an attacker
    // who induces the throttle would be putting that lie in front of
    // everyone. Generic "try again in a minute" is the honest read.
    default:
      console.error(`[twilio-verify] send failed (${status}):`, json.code, json.message);
      return { ok: false, code: "send_failed" };
  }
}

/** Check the code the user typed against the pending verification. */
export async function checkVerification(phone: string, code: string): Promise<CheckResult> {
  let status: number, json: { status?: string; code?: number; message?: string };
  try {
    ({ status, json } = await twilioPost("VerificationCheck", { To: phone, Code: code }));
  } catch (err) {
    console.error("[twilio-verify] check unreachable:", err);
    return { ok: false, code: "check_failed" };
  }

  if (status >= 200 && status < 300) {
    // 200 with status "pending" is Twilio for "wrong code, try again".
    return json.status === "approved" ? { ok: true } : { ok: false, code: "incorrect" };
  }

  switch (json.code) {
    case 20404: // no pending verification — expired (10 min) or already consumed
      return { ok: false, code: "expired" };
    case 60202: // max check attempts reached
      return { ok: false, code: "too_many_checks" };
    // 20429 falls through to generic for the same reason as in
    // startVerification: an account-wide throttle is not this user's fault
    // and must not throw them into the client's 5-minute lockout.
    default:
      console.error(`[twilio-verify] check failed (${status}):`, json.code, json.message);
      return { ok: false, code: "check_failed" };
  }
}
