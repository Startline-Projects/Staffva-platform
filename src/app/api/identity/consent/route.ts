import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { enforceRateLimit, LIMITS } from "@/lib/rateLimit";

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * POST /api/identity/consent — record biometric-processing consent.
 *
 * Server-side because a consent record is only worth keeping if the subject
 * couldn't have forged it: the old client-side write let any authenticated
 * session set id_verification_consent with an arbitrary timestamp and
 * version via PostgREST (and, with MFA enabled, an aal1 half-session could
 * too). Migration 00159 revokes those column grants; this route — behind
 * the same AAL gate as the other identity routes — is now the only writer,
 * and the server supplies the timestamp and version itself.
 */
export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!aal || aal.currentLevel !== aal.nextLevel) { // fail CLOSED: an unreadable AAL is not a satisfied one
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let candidateId: unknown;
  try {
    ({ candidateId } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (typeof candidateId !== "string" || !candidateId) {
    return NextResponse.json({ error: "Missing candidateId" }, { status: 400 });
  }

  // Idempotent and owner-scoped, but still a service-role write — bounded.
  const limited = await enforceRateLimit(`identity-consent:user:${user.id}`, LIMITS.identitySession);
  if (limited) return limited;

  const { data, error } = await getAdminClient()
    .from("candidates")
    .update({
      id_verification_consent: true,
      id_verification_consent_at: new Date().toISOString(),
      id_verification_consent_version: "v1.1",
    })
    .eq("id", candidateId)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[identity-consent] write failed:", error.message);
    return NextResponse.json({ error: "Could not save consent. Try again." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
