import { createClient } from "@supabase/supabase-js";

/**
 * Everything a live candidate has been offered or could apply their time to.
 *
 * One loader, called by both /candidate/work and the dashboard entry point, so
 * the two cannot disagree about whether an offer is waiting. That is not
 * hypothetical caution: the whole of step 13 was spent unpicking three surfaces
 * that each derived candidate state their own way.
 *
 * Service role throughout, for two reasons that are both verified rather than
 * assumed. Offers: the browser cannot read `clients` at all — every permissive
 * policy on that table keys on the client's own auth.uid() — which is why the
 * existing /offers/[id] page renders every employer as "A client". Roles:
 * job_posts grants are table-level, so any RLS policy that let a candidate read
 * a row would hand them `ai_brief`, the column that deliberately holds the
 * client's unfiltered composer prompt ("I run acme-shop.com, need a Shopify
 * VA"). jobs_for_candidate() names its columns instead, and ai_brief is not
 * among them.
 */

export interface WorkOffer {
  id: string;
  status: string;
  hourly_rate: number;
  hours_per_week: number;
  contract_length: string;
  start_date: string;
  signing_bonus_usd: number | null;
  personal_message: string | null;
  sent_at: string | null;
  /** sent_at + 5 days — the window /api/cron/expire-offers actually enforces. */
  respond_by: string | null;
  employer: string | null;
}

export interface WorkRole {
  id: string;
  title: string | null;
  summary: string | null;
  role_category: string | null;
  responsibilities: string[] | null;
  must_have_skills: string[] | null;
  nice_to_have_skills: string[] | null;
  rate_type: string | null;
  hourly_rate_min: number | null;
  hourly_rate_max: number | null;
  fixed_budget: number | null;
  duration_estimate: string | null;
  experience_level: string | null;
  hours_per_week_estimate: string | null;
  published_at: string | null;
  invited_at: string | null;
}

export interface CandidateWork {
  offers: WorkOffer[];
  roles: WorkRole[];
  engagementCount: number;
}

/** Offers still awaiting an answer. The dashboard shouts only for these. */
export function pendingOffers(offers: WorkOffer[]): WorkOffer[] {
  return offers.filter((o) => o.status === "sent" || o.status === "viewed");
}

const RESPOND_WINDOW_DAYS = 5;

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function loadCandidateWork(candidateId: string): Promise<CandidateWork> {
  const db = admin();

  const [offersRes, rolesRes, engRes] = await Promise.all([
    db
      .from("engagement_offers")
      .select(
        "id, status, hourly_rate, hours_per_week, contract_length, start_date, signing_bonus_usd, personal_message, sent_at, clients(full_name, company_name)"
      )
      .eq("candidate_id", candidateId)
      // `expired` is included deliberately. Under the email freeze a candidate
      // is never told an offer arrived, so the likeliest thing that happens to
      // one is that it times out unseen. Dropping it from the list would erase
      // the evidence that they were ever offered work.
      .in("status", ["sent", "viewed", "accepted", "declined", "expired"])
      .order("sent_at", { ascending: false, nullsFirst: false }),
    db.rpc("jobs_for_candidate", { p_candidate_id: candidateId }),
    db
      .from("engagements")
      .select("id", { count: "exact", head: true })
      .eq("candidate_id", candidateId),
  ]);

  // A failed OFFERS read must not render as "you have no offers" — that is the
  // one sentence this must never say wrongly, and the dashboard shouts off this
  // number.
  if (offersRes.error) {
    throw new Error(`offers lookup failed: ${offersRes.error.message}`);
  }
  // Roles are different, deliberately. The dashboard calls this loader for the
  // offer count alone and throws away `roles`, so making a jobs_for_candidate
  // failure fatal would take down a live candidate's only surface over a table
  // the dashboard has never depended on. An empty role list is the honest
  // degradation; an unreachable dashboard is not.
  if (rolesRes.error) {
    console.error("[candidateWork] jobs_for_candidate failed:", rolesRes.error.message);
  }
  // Likewise the engagement count: an error here used to become a confident
  // zero, which is the same absence-vs-failure confusion in miniature. It only
  // drives whether a "your signed work is on the dashboard" pointer renders.
  if (engRes.error) {
    console.error("[candidateWork] engagement count failed:", engRes.error.message);
  }

  const offers: WorkOffer[] = (offersRes.data ?? []).map((o) => {
    const c = o.clients as unknown as
      | { full_name: string | null; company_name: string | null }
      | null;
    return {
      id: o.id as string,
      status: o.status as string,
      hourly_rate: Number(o.hourly_rate),
      hours_per_week: Number(o.hours_per_week),
      contract_length: o.contract_length as string,
      start_date: o.start_date as string,
      signing_bonus_usd: o.signing_bonus_usd == null ? null : Number(o.signing_bonus_usd),
      personal_message: (o.personal_message as string | null) ?? null,
      sent_at: (o.sent_at as string | null) ?? null,
      respond_by: o.sent_at
        ? new Date(Date.parse(o.sent_at as string) + RESPOND_WINDOW_DAYS * 86_400_000).toISOString()
        : null,
      employer: c?.company_name || c?.full_name || null,
    };
  });

  return {
    offers,
    roles: (rolesRes.data ?? []) as WorkRole[],
    engagementCount: engRes.count ?? 0,
  };
}
