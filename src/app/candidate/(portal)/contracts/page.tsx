import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import { loadCandidateContracts } from "@/lib/candidateContracts";
import { BLOCK_COPY } from "@/lib/contractTerms";

/**
 * Every agreement this candidate has, in every state.
 *
 * Eight contracts exist on this platform and not one has been signed by a
 * candidate. The link that would have taken them there lived in an email that
 * is now frozen, and the dashboard's contracts card returns null on any fetch
 * error — so a broken request and "you have none" looked identical.
 *
 * This lists everything, including finished and blocked agreements, because the
 * record matters as much as the signature.
 */
export default async function CandidateContractsPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/candidate/contracts");
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

  const contracts = await loadCandidateContracts(candidate.id);

  return (
    <>
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-[#1C1B1A]">Contracts</h1>
          <p className="mt-1 text-sm text-gray-600">
            Your agreements with clients, and where each one stands.
          </p>
        </div>

        {contracts.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <p className="text-sm text-gray-600">
              You don&apos;t have any contracts yet. One appears here when a client
              hires you and an agreement is drawn up.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {contracts.map((c) => {
              const block = c.blockReason ? BLOCK_COPY[c.blockReason] : null;
              const needsYou = c.blockReason === null;
              const flagged = c.blockReason === "terms_conflict";
              return (
                <Link
                  key={c.id}
                  href={`/candidate/contracts/${c.id}`}
                  className={`block rounded-lg border bg-white p-5 transition-colors hover:border-gray-300 ${
                    flagged ? "border-red-200" : needsYou ? "border-[#FE6E3E]" : "border-gray-200"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#1C1B1A]">
                        {c.employer ?? "A client"}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        Drawn up{" "}
                        {new Date(c.generatedAt).toLocaleDateString("en-US", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                        flagged
                          ? "border-red-200 bg-red-50 text-red-800"
                          : needsYou
                            ? "border-orange-200 bg-orange-50 text-orange-800"
                            : "border-gray-200 bg-gray-50 text-gray-600"
                      }`}
                    >
                      {needsYou ? "Needs your signature" : block?.title ?? c.status}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        <p className="mt-8 text-xs text-gray-400">
          <Link href="/candidate/dashboard" className="hover:underline">
            Back to dashboard
          </Link>
        </p>
      </div>
    </>
  );
}
