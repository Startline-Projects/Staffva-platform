import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * The dispute queue, enriched with who is on each side.
 *
 * Shared by the page (a server component) and `/api/disputes/list`, so the two
 * cannot describe the queue differently. Server-only: reads
 * SUPABASE_SERVICE_ROLE_KEY.
 */

export interface Dispute {
  id: string;
  engagement_id: string;
  period_id: string | null;
  milestone_id: string | null;
  filed_by: string;
  filed_at: string;
  amount_in_escrow_usd: number | null;
  client_statement: string | null;
  candidate_statement: string | null;
  client_evidence_url: string | null;
  candidate_evidence_url: string | null;
  decision: string | null;
  decision_notes: string | null;
  resolved_at: string | null;
  contract_type: string;
  client_name: string;
  candidate_name: string;
}

export type DisputeStatus = "open" | "resolved";

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function isDisputeStaff(): Promise<boolean> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = user?.app_metadata?.role;
  return Boolean(user) && (role === "admin" || role === "recruiting_manager");
}

/** null means the read failed — never an empty queue. */
export async function loadDisputes(status: DisputeStatus): Promise<Dispute[] | null> {
  if (!(await isDisputeStaff())) return null;

  const db = serviceClient();

  let query = db.from("disputes").select("*").order("filed_at", { ascending: false });
  query = status === "open" ? query.is("resolved_at", null) : query.not("resolved_at", "is", null);

  const { data: disputes, error } = await query;
  if (error) return null;
  if (!disputes?.length) return [];

  const engagementIds = [...new Set(disputes.map((d) => d.engagement_id).filter(Boolean))];
  const { data: engagements } = engagementIds.length
    ? await db.from("engagements").select("id, client_id, candidate_id, contract_type").in("id", engagementIds)
    : { data: [] };

  const engMap = new Map((engagements ?? []).map((e) => [e.id, e]));
  const clientIds = [...new Set((engagements ?? []).map((e) => e.client_id).filter(Boolean))] as string[];
  const candidateIds = [...new Set((engagements ?? []).map((e) => e.candidate_id).filter(Boolean))] as string[];

  const [clientsRes, candidatesRes] = await Promise.all([
    clientIds.length ? db.from("clients").select("id, full_name, company_name").in("id", clientIds) : Promise.resolve({ data: [] }),
    // full_name first: the previous version read display_name alone, so any
    // candidate without one showed as "Unknown" on a money dispute.
    candidateIds.length ? db.from("candidates").select("id, full_name, display_name").in("id", candidateIds) : Promise.resolve({ data: [] }),
  ]);

  const clientMap = new Map((clientsRes.data ?? []).map((c) => [c.id, c.company_name || c.full_name]));
  const candidateMap = new Map((candidatesRes.data ?? []).map((c) => [c.id, c.full_name || c.display_name]));

  return disputes.map((d) => {
    const eng = engMap.get(d.engagement_id);
    return {
      ...d,
      amount_in_escrow_usd: d.amount_in_escrow_usd === null ? null : Number(d.amount_in_escrow_usd),
      contract_type: eng?.contract_type ?? "unknown",
      client_name: (eng && clientMap.get(eng.client_id)) || "Unknown",
      candidate_name: (eng && candidateMap.get(eng.candidate_id)) || "Unknown",
    } as Dispute;
  });
}
