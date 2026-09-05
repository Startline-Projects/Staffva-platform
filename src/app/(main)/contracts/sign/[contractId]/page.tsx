import { redirect } from "next/navigation";

/**
 * Superseded by /candidate/contracts/[contractId] (step 16).
 *
 * The page that lived here authenticated by a ?token query parameter carried in
 * an email. All eight live signing tokens were minted in April against a
 * seven-day expiry, and candidate email is frozen — so the only documented route
 * to signing had expired for every contract in the system. It also hid the
 * document once signed and offered a PDF download that has never worked, because
 * contract_pdf_url is NULL on all eight.
 *
 * The replacement authorizes by ownership instead, and renders the agreement in
 * every state. Kept as a redirect because the old links are in inboxes.
 */
export default async function ContractSignRedirect({
  params,
}: {
  params: Promise<{ contractId: string }>;
}) {
  const { contractId } = await params;
  redirect(`/candidate/contracts/${contractId}`);
}
