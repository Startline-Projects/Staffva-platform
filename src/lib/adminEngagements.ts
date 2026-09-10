import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * Engagements, and the money attached to them.
 *
 * Two things about this schema that the pages have to get right:
 *
 * 1. `engagements.candidate_rate_usd` is NOT an hourly rate on an ongoing
 *    contract — it is the amount for one payment cycle. Every
 *    `payment_periods.amount_usd` on the platform equals its engagement's
 *    `candidate_rate_usd` exactly, which is only consistent with a per-cycle
 *    reading. `weekly_hours` is null on every row, so there is nothing to
 *    multiply by even if you wanted the other reading.
 *
 * 2. `engagements.status` and the money are independent. The enum is
 *    active | payment_failed | released | completed, and it describes the
 *    engagement, not the escrow: today four engagements read `released` while
 *    every milestone and every payment period is still `pending`. The pages
 *    show both and never translate one into the other.
 *
 * Server-only: reads SUPABASE_SERVICE_ROLE_KEY.
 */

export interface EngagementRow {
  id: string;
  status: string;
  contractType: string;
  paymentCycle: string | null;
  candidateAmountUsd: number | null;
  platformFeeUsd: number | null;
  clientTotalUsd: number | null;
  createdAt: string;
  pausedAt: string | null;
  endsAt: string | null;
  clientId: string | null;
  clientName: string | null;
  candidateId: string | null;
  candidateName: string | null;
  contractStatus: string | null;
  /** Escrow rows and how many of them have moved past `pending`. */
  escrow: { total: number; funded: number; released: number; kind: "milestones" | "periods" | "none" };
}

export interface EngagementDetail extends EngagementRow {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  e: Record<string, any>;
  milestones: {
    id: string; title: string | null; description: string | null; amountUsd: number | null;
    status: string; fundedAt: string | null; approvedAt: string | null; releasedAt: string | null;
    autoReleaseAt: string | null; payoutFailed: boolean | null; payoutFailureReason: string | null;
  }[];
  periods: {
    id: string; periodStart: string | null; periodEnd: string | null; amountUsd: number | null;
    status: string; fundedAt: string | null; releasedAt: string | null; disputeFiledAt: string | null;
    autoReleaseAt: string | null; payoutFailed: boolean | null; payoutFailureReason: string | null;
  }[];
  contract: {
    id: string; status: string; generatedAt: string | null;
    clientSignedAt: string | null; candidateSignedAt: string | null; pdfUrl: string | null;
  } | null;
}

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function assertStaff() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = user?.app_metadata?.role;
  if (!user || (role !== "admin" && role !== "recruiting_manager")) return null;
  return { user, role };
}

const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function loadEngagements(): Promise<EngagementRow[] | null> {
  if (!(await assertStaff())) return null;
  const db = serviceClient();

  const { data: engagements, error } = await db
    .from("engagements")
    .select("id, status, contract_type, payment_cycle, candidate_rate_usd, platform_fee_usd, client_total_usd, created_at, paused_at, ends_at, client_id, candidate_id")
    .order("created_at", { ascending: false });

  if (error || !engagements) return null;

  const ids = engagements.map((e) => e.id);
  const clientIds = [...new Set(engagements.map((e) => e.client_id).filter(Boolean))] as string[];
  const candidateIds = [...new Set(engagements.map((e) => e.candidate_id).filter(Boolean))] as string[];

  const [clientsRes, candidatesRes, contractsRes, msRes, ppRes] = await Promise.all([
    clientIds.length ? db.from("clients").select("id, full_name, company_name").in("id", clientIds) : Promise.resolve({ data: [] }),
    candidateIds.length ? db.from("candidates").select("id, full_name, display_name").in("id", candidateIds) : Promise.resolve({ data: [] }),
    ids.length ? db.from("engagement_contracts").select("engagement_id, status").in("engagement_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? db.from("milestones").select("engagement_id, status").in("engagement_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? db.from("payment_periods").select("engagement_id, status").in("engagement_id", ids) : Promise.resolve({ data: [] }),
  ]);

  const clients = new Map((clientsRes.data ?? []).map((c) => [c.id, c.company_name || c.full_name]));
  const candidates = new Map((candidatesRes.data ?? []).map((c) => [c.id, c.full_name || c.display_name]));
  const contracts = new Map((contractsRes.data ?? []).map((c) => [c.engagement_id, c.status]));

  function escrowFor(engagementId: string): EngagementRow["escrow"] {
    const ms = (msRes.data ?? []).filter((m) => m.engagement_id === engagementId);
    const pp = (ppRes.data ?? []).filter((p) => p.engagement_id === engagementId);
    const rows = ms.length ? ms : pp;
    const kind: EngagementRow["escrow"]["kind"] = ms.length ? "milestones" : pp.length ? "periods" : "none";
    return {
      total: rows.length,
      funded: rows.filter((r) => r.status !== "pending").length,
      released: rows.filter((r) => r.status === "released").length,
      kind,
    };
  }

  return engagements.map((e) => ({
    id: e.id,
    status: e.status,
    contractType: e.contract_type,
    paymentCycle: e.payment_cycle,
    candidateAmountUsd: n(e.candidate_rate_usd),
    platformFeeUsd: n(e.platform_fee_usd),
    clientTotalUsd: n(e.client_total_usd),
    createdAt: e.created_at,
    pausedAt: e.paused_at,
    endsAt: e.ends_at,
    clientId: e.client_id,
    clientName: e.client_id ? (clients.get(e.client_id) ?? null) : null,
    candidateId: e.candidate_id,
    candidateName: e.candidate_id ? (candidates.get(e.candidate_id) ?? null) : null,
    contractStatus: contracts.get(e.id) ?? null,
    escrow: escrowFor(e.id),
  }));
}

export async function loadEngagement(id: string): Promise<EngagementDetail | null> {
  if (!(await assertStaff())) return null;
  const db = serviceClient();

  const { data: e, error } = await db.from("engagements").select("*").eq("id", id).maybeSingle();
  if (error || !e) return null;

  const [clientRes, candidateRes, contractRes, msRes, ppRes] = await Promise.all([
    e.client_id ? db.from("clients").select("id, full_name, company_name").eq("id", e.client_id).maybeSingle() : Promise.resolve({ data: null }),
    e.candidate_id ? db.from("candidates").select("id, full_name, display_name").eq("id", e.candidate_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("engagement_contracts").select("id, status, generated_at, client_signed_at, candidate_signed_at, contract_pdf_url").eq("engagement_id", id).maybeSingle(),
    db.from("milestones").select("*").eq("engagement_id", id).order("created_at"),
    db.from("payment_periods").select("*").eq("engagement_id", id).order("period_start"),
  ]);

  const milestones = (msRes.data ?? []).map((m) => ({
    id: m.id, title: m.title, description: m.description, amountUsd: n(m.amount_usd), status: m.status,
    fundedAt: m.funded_at, approvedAt: m.approved_at, releasedAt: m.released_at,
    autoReleaseAt: m.auto_release_at, payoutFailed: m.payout_failed, payoutFailureReason: m.payout_failure_reason,
  }));

  const periods = (ppRes.data ?? []).map((p) => ({
    id: p.id, periodStart: p.period_start, periodEnd: p.period_end, amountUsd: n(p.amount_usd), status: p.status,
    fundedAt: p.funded_at, releasedAt: p.released_at, disputeFiledAt: p.dispute_filed_at,
    autoReleaseAt: p.auto_release_at, payoutFailed: p.payout_failed, payoutFailureReason: p.payout_failure_reason,
  }));

  const rows = milestones.length ? milestones : periods;
  const kind: EngagementRow["escrow"]["kind"] = milestones.length ? "milestones" : periods.length ? "periods" : "none";

  const clientRow = clientRes.data as { company_name?: string | null; full_name?: string | null } | null;
  const candidateRow = candidateRes.data as { full_name?: string | null; display_name?: string | null } | null;

  return {
    e,
    id: e.id,
    status: e.status,
    contractType: e.contract_type,
    paymentCycle: e.payment_cycle,
    candidateAmountUsd: n(e.candidate_rate_usd),
    platformFeeUsd: n(e.platform_fee_usd),
    clientTotalUsd: n(e.client_total_usd),
    createdAt: e.created_at,
    pausedAt: e.paused_at,
    endsAt: e.ends_at,
    clientId: e.client_id,
    clientName: clientRow ? (clientRow.company_name || clientRow.full_name || null) : null,
    candidateId: e.candidate_id,
    candidateName: candidateRow ? (candidateRow.full_name || candidateRow.display_name || null) : null,
    contractStatus: contractRes.data?.status ?? null,
    escrow: {
      total: rows.length,
      funded: rows.filter((r) => r.status !== "pending").length,
      released: rows.filter((r) => r.status === "released").length,
      kind,
    },
    milestones,
    periods,
    contract: contractRes.data
      ? {
          id: contractRes.data.id,
          status: contractRes.data.status,
          generatedAt: contractRes.data.generated_at,
          clientSignedAt: contractRes.data.client_signed_at,
          candidateSignedAt: contractRes.data.candidate_signed_at,
          pdfUrl: contractRes.data.contract_pdf_url,
        }
      : null,
  };
}
