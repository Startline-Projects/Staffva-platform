import { createClient } from "@supabase/supabase-js";
import { contactSafeClientName, contactSafeFirstName } from "@/lib/contactSafeName";
import { maskContact } from "@/lib/contactMask";

/**
 * A candidate's view of a client — Atlas 4.23, built from what this database
 * can actually vouch for.
 *
 * The prototype's page carries "Verified Client" pills, a company bio, a
 * working-style blurb, industries, and a would-hire percentage. None of that
 * has backing data here: there is no client verification of any kind, no bio
 * column, and reviews don't ask "would you work with them again". Per the
 * program's standing rule, this loader computes ONLY facts the database can
 * defend — tenure, hiring activity, payment record, signed contracts, and the
 * candidate-authored reviews from step 17 — and the page says nothing else.
 * client_reviews_private finally gets its reader: the view kept a
 * service-role-only grant until "a client-reputation surface with a real
 * access rule behind it" existed. This is that surface, and the access rule
 * is the relationship gate below.
 *
 * ACCESS: a candidate may see a client's profile only when the client has
 * engaged with THEM — an offer, a message thread, or an engagement. Everyone
 * else gets the locked state, which carries no client data at all (not even
 * the name), so probing arbitrary uuids yields nothing.
 */

export interface ClientReview {
  id: string;
  rating: number;
  body: string | null;
  submitted_at: string;
}

export interface ClientProfile {
  /** Company first, person second, never a contact channel. */
  name: string;
  /** The contact person's FIRST name only — the candidate-facing convention. */
  contactFirstName: string | null;
  memberSince: string;
  stats: {
    totalHires: number;
    activeNow: number;
    distinctCandidates: number;
    /** Hired at least one person more than once. Null when < 2 hires (a rate
     *  computed from one data point is noise wearing a percent sign). */
    repeatHireRate: number | null;
  };
  trust: {
    /** They have actually funded escrow at least once — a completed charge,
     *  not a Stripe customer id that gets minted when the funding modal is
     *  merely opened. */
    hasFundedEscrow: boolean;
    paymentsReleased: number;
    contractsExecuted: number;
  };
  reviews: {
    average: number | null;
    count: number;
    items: ClientReview[];
  };
}

export type ClientProfileResult =
  | { access: "ok"; profile: ClientProfile }
  | { access: "locked" };

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function loadClientProfileForCandidate(
  candidateId: string,
  clientId: string
): Promise<ClientProfileResult> {
  const db = admin();

  // ── The relationship gate, before any client data is touched ──
  const [{ count: offerCount }, { count: engagementCount }, { count: threadCount }] =
    await Promise.all([
      db
        .from("engagement_offers")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId)
        .eq("candidate_id", candidateId),
      db
        .from("engagements")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId)
        .eq("candidate_id", candidateId),
      db
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId)
        .eq("candidate_id", candidateId),
    ]);
  if (!offerCount && !engagementCount && !threadCount) {
    return { access: "locked" };
  }

  const { data: client, error } = await db
    .from("clients")
    .select("full_name, company_name, created_at")
    .eq("id", clientId)
    .maybeSingle();
  // A relationship row pointing at a missing client is a data fault; the
  // locked screen is the safe rendering of it, not a crash.
  if (error || !client) return { access: "locked" };

  // ── Hiring activity ──
  // Past the gate, errors THROW. "?? []" here rendered a transient network
  // hiccup as "no hires, no payments, no reviews" — confident false negatives
  // feeding a real accept/decline decision, the audited swallow-and-continue
  // pattern reborn on the page built to end it.
  const { data: engagements, error: engErr } = await db
    .from("engagements")
    .select("id, candidate_id, status")
    .eq("client_id", clientId);
  if (engErr) throw new Error(`client engagements read failed: ${engErr.message}`);
  const engs = engagements ?? [];
  const engagementIds = engs.map((e) => e.id);
  const distinct = new Set(engs.map((e) => e.candidate_id));
  const perCandidate = new Map<string, number>();
  for (const e of engs) {
    perCandidate.set(e.candidate_id, (perCandidate.get(e.candidate_id) ?? 0) + 1);
  }
  const repeat = [...perCandidate.values()].filter((n) => n > 1).length;

  // ── Payment record + executed contracts ──
  let paymentsReleased = 0;
  let contractsExecuted = 0;
  let hasFundedEscrow = false;
  if (engagementIds.length > 0) {
    const [periodsRes, milestonesRes, executedRes, fundedRes] =
      await Promise.all([
        db
          .from("payment_periods")
          .select("id", { count: "exact", head: true })
          .in("engagement_id", engagementIds)
          .eq("status", "released"),
        db
          .from("milestones")
          .select("id", { count: "exact", head: true })
          .in("engagement_id", engagementIds)
          .eq("status", "released"),
        db
          .from("engagement_contracts")
          .select("id", { count: "exact", head: true })
          .in("engagement_id", engagementIds)
          .eq("status", "fully_executed"),
        db
          .from("payment_periods")
          .select("id", { count: "exact", head: true })
          .in("engagement_id", engagementIds)
          .not("funded_at", "is", null),
      ]);
    const failed = [periodsRes.error, milestonesRes.error, executedRes.error, fundedRes.error].find(Boolean);
    if (failed) throw new Error(`client track-record read failed: ${failed.message}`);
    paymentsReleased = (periodsRes.count ?? 0) + (milestonesRes.count ?? 0);
    contractsExecuted = executedRes.count ?? 0;
    hasFundedEscrow = (fundedRes.count ?? 0) > 0 || paymentsReleased > 0;
  }

  // ── Reviews candidates wrote about this client (step 17's sealed pairs;
  //    the view applies the reveal + published rules, so nothing unrevealed
  //    can appear here) ──
  // Ratings uncapped (they're one int per row) so the average and count are
  // TRUE totals; only the displayed bodies are capped. The 20-row version
  // labeled a recency-biased mean of the latest 20 as the overall rating.
  const [{ data: allRatings, error: ratingsErr }, { data: reviewRows, error: reviewsErr }] =
    await Promise.all([
      db
        .from("client_reviews_private")
        .select("rating")
        .eq("client_id", clientId),
      db
        .from("client_reviews_private")
        .select("id, rating, body, submitted_at")
        .eq("client_id", clientId)
        .order("submitted_at", { ascending: false })
        .limit(20),
    ]);
  if (ratingsErr || reviewsErr) {
    throw new Error(`client reviews read failed: ${(ratingsErr ?? reviewsErr)!.message}`);
  }
  const ratings = allRatings ?? [];
  const reviews = (reviewRows ?? []).map((r) => ({
    ...r,
    // Render-time contact masking: review bodies had no display surface until
    // this page, so no write-side filter ever ran on them — and the identical
    // string is 400'd in a message body. maskContact is the platform's own
    // helper for exactly this case.
    body: r.body ? maskContact(r.body) : r.body,
  }));
  const average =
    ratings.length > 0
      ? Math.round((ratings.reduce((s, r) => s + r.rating, 0) / ratings.length) * 10) / 10
      : null;

  return {
    access: "ok",
    profile: {
      name: contactSafeClientName(client.company_name, client.full_name),
      // Through the same filter as the display name — the review showed
      // "hireme@gmail.com" as a whole first token and "+63917... Juan" hiding
      // the payload IN the token, both sailing past the name-side check onto
      // the trust page.
      contactFirstName: contactSafeFirstName(client.full_name),
      memberSince: client.created_at,
      stats: {
        totalHires: engs.length,
        activeNow: engs.filter((e) => e.status === "active").length,
        distinctCandidates: distinct.size,
        repeatHireRate:
          engs.length >= 2 && distinct.size > 0
            ? Math.round((repeat / distinct.size) * 100)
            : null,
      },
      trust: {
        hasFundedEscrow,
        paymentsReleased,
        contractsExecuted,
      },
      reviews: { average, count: ratings.length, items: reviews },
    },
  };
}
