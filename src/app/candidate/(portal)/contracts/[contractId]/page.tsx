import { createClient } from "@supabase/supabase-js";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import { loadCandidateContracts } from "@/lib/candidateContracts";
import ContractRecord from "@/components/candidate/ContractRecord";
import NoticeControl from "@/components/candidate/NoticeControl";

/**
 * One agreement, readable in full whatever state it is in.
 *
 * Authorization is by ownership, not by token: the contract must belong to the
 * signed-in candidate. The old page took a ?token query parameter, and all eight
 * live tokens were minted in April against a seven-day expiry — so the only
 * documented way in had already expired for every one of them.
 */
export default async function CandidateContractPage({
  params,
}: {
  params: Promise<{ contractId: string }>;
}) {
  const { contractId } = await params;

  const user = await getUser();
  if (!user) redirect(`/login?next=/candidate/contracts/${contractId}`);
  if (user.app_metadata?.role !== "candidate") redirect("/dashboard");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: candidate, error } = await admin
    .from("candidates")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(`candidate lookup failed: ${error.message}`);
  if (!candidate) redirect("/candidate/dashboard");

  // Loaded through the candidate's own list, so a contract belonging to someone
  // else simply is not here — the ownership check and the read are the same
  // query rather than two rules that could drift apart.
  const contracts = await loadCandidateContracts(candidate.id);
  const contract = contracts.find((c) => c.id === contractId);
  if (!contract) notFound();

  return (
    <>
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6">
          <Link href="/candidate/contracts" className="text-xs text-gray-500 hover:underline">
            ← All contracts
          </Link>
          <h1 className="mt-2 text-xl font-bold text-[#1C1B1A]">
            Agreement with{" "}
            {contract.client_id ? (
              <Link href={`/candidate/clients/${contract.client_id}`} className="underline decoration-gray-300 underline-offset-2 hover:decoration-[#1C1B1A]">
                {contract.employer ?? "a client"}
              </Link>
            ) : (
              contract.employer ?? "a client"
            )}
          </h1>
        </div>

        <div className="mb-4">
          <NoticeControl
            engagementId={contract.engagementId}
            engagementStatus={contract.engagementStatus}
            contractStatus={contract.status}
            noticeGivenAt={contract.noticeGivenAt}
            noticeGivenBy={contract.noticeGivenBy}
            endsAt={contract.endsAt}
          />
        </div>

        <ContractRecord
          contractId={contract.id}
          contractHtml={contract.contractHtml}
          blockReason={contract.blockReason}
          employer={contract.employer}
          clientSignedAt={contract.clientSignedAt}
          candidateSignedAt={contract.candidateSignedAt}
          engagementAmountUsd={contract.engagementAmountUsd}
          engagementBasis={contract.engagementBasis}
        />
      </div>
    </>
  );
}
