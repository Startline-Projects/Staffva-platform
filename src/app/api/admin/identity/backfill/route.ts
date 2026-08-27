import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { recordVerifiedIdentity } from "@/lib/identityAnchor";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function isAuthorized(req: NextRequest): Promise<boolean> {
  // Either the cron secret (curl) or a signed-in admin session.
  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader === `Bearer ${process.env.CRON_SECRET}`) return true;

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile } = await getAdminClient()
    .from("profiles").select("role").eq("id", user.id).single();
  return profile?.role === "admin" || profile?.role === "recruiting_manager";
}

/**
 * POST /api/admin/identity/backfill
 *
 * Recover the identity anchors for candidates verified BEFORE the anchor
 * existed. Until today, create-session discarded Stripe's session id and the
 * webhook never INSERTed into verified_identities — so 105 candidates are
 * marked id_verification_status='passed' with no retrievable record of the
 * verification behind it. Some of those are real Stripe verifications whose
 * handle we simply dropped; an unknown number are the browser's old
 * "auto-pass after 30 seconds" writing 'passed' with no Stripe session at
 * all. This route tells the two apart, and it is the only thing that can.
 *
 * It pages through Stripe's verification sessions (they are all ours — the
 * account exists for this product), matches metadata.candidate_id, and for
 * each VERIFIED session anchors it exactly the way the webhook now does:
 * session id on the candidate, identity hash + duplicate detection in
 * verified_identities. Candidates whose DB row says 'passed' but for whom
 * Stripe holds no verified session are REPORTED, not modified — deciding what
 * to do about a candidate who was never actually verified is a human call.
 *
 * Idempotent: re-running re-anchors the same sessions to the same rows.
 */
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getAdminClient();
  const stripe = getStripe();

  // Collect every verification session Stripe holds for this account.
  const sessions: { id: string; status: string; candidateId: string | null }[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < 50; page++) {
    const batch = await stripe.identity.verificationSessions.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const s of batch.data) {
      sessions.push({
        id: s.id,
        status: s.status,
        candidateId: (s.metadata as Record<string, string>)?.candidate_id || null,
      });
    }
    if (!batch.has_more || batch.data.length === 0) break;
    startingAfter = batch.data[batch.data.length - 1].id;
  }

  // Newest first from Stripe; keep only the newest VERIFIED session per
  // candidate so a retry does not anchor an older session over a newer one.
  const newestVerified = new Map<string, string>();
  for (const s of sessions) {
    if (s.status === "verified" && s.candidateId && !newestVerified.has(s.candidateId)) {
      newestVerified.set(s.candidateId, s.id);
    }
  }

  let anchored = 0;
  let duplicates = 0;
  const errors: string[] = [];
  for (const [candidateId, sessionId] of newestVerified) {
    const result = await recordVerifiedIdentity({ supabase, stripe, candidateId, sessionId });
    if (result.outcome === "anchored") anchored++;
    else if (result.outcome === "duplicate") duplicates++;
    else errors.push(`${candidateId}: ${result.message}`);
  }

  // The reckoning: who does the DB call verified that Stripe has no verified
  // session for? These are the candidates the old client-side auto-pass let
  // through — or whose session predates this Stripe account's retention.
  const { data: passedCandidates } = await supabase
    .from("candidates")
    .select("id, display_name, email, admin_status")
    .eq("id_verification_status", "passed");

  const unverifiable = (passedCandidates || []).filter((c) => !newestVerified.has(c.id));

  return NextResponse.json({
    stripe: {
      sessionsScanned: sessions.length,
      verifiedWithCandidate: newestVerified.size,
      verifiedWithoutCandidateMetadata: sessions.filter(
        (s) => s.status === "verified" && !s.candidateId
      ).length,
    },
    anchored,
    duplicatesFlagged: duplicates,
    errors,
    passedInDbButNoStripeVerification: {
      count: unverifiable.length,
      candidates: unverifiable.map((c) => ({
        id: c.id,
        name: c.display_name,
        email: c.email,
        admin_status: c.admin_status,
      })),
    },
  });
}
