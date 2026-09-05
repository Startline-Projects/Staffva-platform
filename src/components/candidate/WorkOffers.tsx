import Link from "next/link";
import type { WorkOffer } from "@/lib/candidateWork";

/**
 * Offers a client has actually sent.
 *
 * This section exists because an offer sent today reaches the candidate through
 * nothing at all. The responder page at /offers/[id] works, but the only link to
 * it lived inside an email, and that email is now correctly suppressed by the
 * candidate freeze. So the offer arrives and the person it is for cannot find it.
 *
 * (An earlier version of this comment claimed all 8 engagements began as an
 * offer. They did not: engagement_offers holds one row against eight
 * engagements, and engagements carries no column referencing an offer — only
 * is_direct_contract, which is false on all eight. So they were not direct
 * contracts, but which flow did create them is not recorded. Worth knowing
 * before anyone builds on the assumption.)
 *
 * Renders nothing when there are no offers. No "no offers yet" box: an empty
 * container is a place for a claim to grow, and the ContractsSection idiom
 * already in this codebase returns null the same way.
 */

const STATUS: Record<string, { label: string; cls: string }> = {
  sent: { label: "Awaiting your answer", cls: "bg-orange-50 text-orange-800 border-orange-200" },
  viewed: { label: "Awaiting your answer", cls: "bg-orange-50 text-orange-800 border-orange-200" },
  accepted: { label: "Accepted", cls: "bg-green-50 text-green-800 border-green-200" },
  declined: { label: "Declined", cls: "bg-gray-50 text-gray-600 border-gray-200" },
  expired: { label: "Expired", cls: "bg-gray-50 text-gray-600 border-gray-200" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function WorkOffers({ offers }: { offers: WorkOffer[] }) {
  if (offers.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Offers</h2>
      <div className="space-y-3">
        {offers.map((o) => {
          const open = o.status === "sent" || o.status === "viewed";
          const s = STATUS[o.status] ?? STATUS.expired;
          return (
            <div
              key={o.id}
              className={`rounded-lg border bg-white p-5 ${
                open ? "border-[#FE6E3E]" : "border-gray-200"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#1C1B1A]">
                    {/* Loaded server-side. The browser cannot read `clients`,
                        which is why /offers/[id] says "A client" — worth fixing
                        there too rather than copying the limitation here. */}
                    {o.client_id ? (
                      <Link
                        href={`/candidate/clients/${o.client_id}`}
                        className="hover:underline"
                      >
                        {o.employer ?? "A client"}
                      </Link>
                    ) : (
                      o.employer ?? "A client"
                    )}
                  </p>
                  <p className="mt-0.5 text-sm text-gray-600">
                    ${o.hourly_rate}/hr · {o.hours_per_week} hrs/week · {o.contract_length}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Starts {fmtDate(o.start_date)}
                    {o.signing_bonus_usd
                      ? ` · $${o.signing_bonus_usd.toLocaleString()} signing bonus`
                      : ""}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>
                  {s.label}
                </span>
              </div>

              {o.personal_message && (
                <blockquote className="mt-3 border-l-2 border-gray-200 pl-3 text-sm italic text-gray-600">
                  {o.personal_message}
                </blockquote>
              )}

              {open && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Link
                    href={`/offers/${o.id}`}
                    className="rounded-full bg-[#FE6E3E] px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#E55A2B]"
                  >
                    Review this offer
                  </Link>
                  {o.respond_by && (
                    // A date, never a live countdown. The expiry is enforced by
                    // a daily cron, so between the deadline passing and the next
                    // run the offer still accepts — a ticking "expired" would be
                    // wrong for up to 24 hours.
                    <span className="text-xs text-gray-500">Respond by {fmtDate(o.respond_by)}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
