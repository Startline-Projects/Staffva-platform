import { createClient } from "@supabase/supabase-js";
import { signBlockReason, type BlockReason } from "@/lib/contractTerms";

/**
 * A candidate's agreements — every one, in every state.
 *
 * Service role throughout, and not by preference: engagement_contracts has zero
 * RLS policies, so PostgREST returns nothing at all to a browser session.
 *
 * The reason this exists: eight contracts have been generated on this platform
 * and not one has ever been signed by a candidate. Four wait on the candidate,
 * four on the client, none has a PDF. All four ACTIVE engagements are running
 * under an unsigned agreement. The signing link was carried by an email that is
 * now frozen, and the people it was sent to have not signed in since April.
 */

export interface CandidateContract {
  id: string;
  engagementId: string;
  status: string;
  engagementStatus: string | null;
  employer: string | null;
  generatedAt: string;
  clientSignedAt: string | null;
  candidateSignedAt: string | null;
  contractHtml: string;
  /** Null means the candidate can sign it. Otherwise, why not. */
  blockReason: BlockReason | null;
  /** What the DOCUMENT states, and what the ENGAGEMENT records. Both, always. */
  engagementAmountUsd: number | null;
  engagementBasis: string | null;
  weeklyHours: number | null;
}

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Agreements this candidate can actually sign right now. */
export function signableContracts(cs: CandidateContract[]): CandidateContract[] {
  return cs.filter((c) => c.blockReason === null);
}

/** Agreements stopped because the document contradicts the engagement. */
export function flaggedContracts(cs: CandidateContract[]): CandidateContract[] {
  return cs.filter((c) => c.blockReason === "terms_conflict");
}

export async function loadCandidateContracts(
  candidateId: string
): Promise<CandidateContract[]> {
  const db = admin();

  const { data: rows, error } = await db
    .from("engagement_contracts")
    .select(
      "id, engagement_id, status, generated_at, client_signed_at, candidate_signed_at, contract_html, clients(full_name, company_name)"
    )
    .eq("candidate_id", candidateId)
    .order("generated_at", { ascending: false });

  // A failed read must never render as "you have no contracts". That silent
  // degradation is how this went unnoticed: ContractsSection catches its own
  // fetch error and returns null, so a broken request and an empty list look
  // identical on the dashboard.
  if (error) throw new Error(`contracts read failed: ${error.message}`);

  const list = rows ?? [];
  if (list.length === 0) return [];

  const engIds = [...new Set(list.map((r) => r.engagement_id))];
  const { data: engs, error: engErr } = await db
    .from("engagements")
    .select("id, status, weekly_hours, payment_cycle, contract_type, candidate_rate_usd")
    .in("id", engIds);
  if (engErr) throw new Error(`engagement read failed: ${engErr.message}`);

  const engMap = new Map((engs ?? []).map((e) => [e.id, e]));

  return list.map((r) => {
    const e = engMap.get(r.engagement_id);
    const c = r.clients as unknown as
      | { full_name: string | null; company_name: string | null }
      | null;

    return {
      id: r.id as string,
      engagementId: r.engagement_id as string,
      status: r.status as string,
      engagementStatus: (e?.status as string) ?? null,
      employer: c?.company_name || c?.full_name || null,
      generatedAt: r.generated_at as string,
      clientSignedAt: (r.client_signed_at as string) ?? null,
      candidateSignedAt: (r.candidate_signed_at as string) ?? null,
      contractHtml: (r.contract_html as string) ?? "",
      blockReason: signBlockReason(
        {
          contractStatus: r.status as string,
          engagementStatus: (e?.status as string) ?? null,
          weeklyHours: (e?.weekly_hours as number) ?? null,
          paymentCycle: (e?.payment_cycle as string) ?? null,
          contractType: (e?.contract_type as string) ?? null,
        },
        "candidate"
      ),
      engagementAmountUsd: e?.candidate_rate_usd == null ? null : Number(e.candidate_rate_usd),
      engagementBasis: (e?.payment_cycle as string) ?? (e?.contract_type as string) ?? null,
      weeklyHours: (e?.weekly_hours as number) ?? null,
    };
  });
}
