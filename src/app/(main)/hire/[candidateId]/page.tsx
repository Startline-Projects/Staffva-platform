import { redirect } from "next/navigation";

/**
 * The direct-hire page is retired. It created an ACTIVE engagement and
 * contract in one click — no offer, no candidate acceptance, no
 * notification — and pre-filled the candidate's hourly rate into a field
 * labeled monthly (interface audit, Aug 31 2026). Hiring now has exactly
 * one path: an offer the candidate accepts. Old links land there.
 */
export default async function DirectHireRedirect({
  params,
}: {
  params: Promise<{ candidateId: string }>;
}) {
  const { candidateId } = await params;
  redirect(`/hire/${candidateId}/offer`);
}
