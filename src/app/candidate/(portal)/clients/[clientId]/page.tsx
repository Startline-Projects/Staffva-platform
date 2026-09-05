import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import { loadClientProfileForCandidate } from "@/lib/clientProfile";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * The client, seen from the candidate's side — Atlas 4.23.
 *
 * Until this page existed, a candidate accepted binding offers, signed
 * contracts, and held conversations with a bare name. Everything rendered
 * here is a fact the database can defend; the Atlas prototype's "Verified
 * Client" pills, bio, and would-hire percentage have no backing data and are
 * deliberately absent rather than faked.
 *
 * Locked unless this client has engaged with THIS candidate (offer, message,
 * or engagement) — and the locked state carries no client data at all, so the
 * URL is not an enumeration oracle.
 */
export default async function ClientProfilePage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const user = await getUser();
  if (!user) redirect(`/login?next=/candidate/dashboard`);
  if (user.app_metadata?.role !== "candidate") redirect("/dashboard");

  const { data: candidate } = await admin()
    .from("candidates")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!candidate) redirect("/candidate/dashboard");

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const result = UUID_RE.test(clientId)
    ? await loadClientProfileForCandidate(candidate.id, clientId)
    : ({ access: "locked" } as const);

  if (result.access === "locked") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-xl font-bold text-[#1C1B1A]">This profile isn&apos;t available</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">
          Client profiles open once a client has engaged with you — when they
          message you, send you an offer, or hire you.
        </p>
        <Link
          href="/candidate/work"
          className="mt-6 inline-block rounded-full border border-gray-300 px-6 py-2 text-sm font-semibold text-[#1C1B1A] hover:border-[#1C1B1A]"
        >
          See what&apos;s open
        </Link>
      </div>
    );
  }

  const p = result.profile;
  const since = new Date(p.memberSince);
  const sinceLabel = since.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  // Server component: "now" is request time by design (the purity rule is
  // written for client-side re-renders).
  // eslint-disable-next-line react-hooks/purity
  const years = (Date.now() - since.getTime()) / (365.25 * 24 * 3600 * 1000);
  const roundedYears = Math.round(years * 10) / 10;
  const tenure =
    years >= 1
      ? `${roundedYears} ${roundedYears === 1 ? "year" : "years"} on StaffVA`
      : "New to StaffVA";

  const stat = (n: number | string, label: string) => (
    <div className="rounded-xl border border-gray-200 bg-white p-4 text-center">
      <div className="text-2xl font-bold text-[#1C1B1A]">{n}</div>
      <div className="mt-0.5 text-xs text-gray-500">{label}</div>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Hero */}
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[#1C1B1A] text-2xl font-bold text-[#D6F24D]">
          {p.name.charAt(0).toUpperCase()}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-[#1C1B1A]">{p.name}</h1>
          <p className="mt-0.5 text-sm text-gray-600">
            {p.contactFirstName ? `Contact: ${p.contactFirstName} · ` : ""}
            Member since {sinceLabel}
          </p>
        </div>
      </div>

      {/* Hiring activity */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Hiring activity
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stat(p.stats.totalHires, "Hires on StaffVA")}
          {stat(p.stats.activeNow, "Currently active")}
          {stat(p.stats.distinctCandidates, "People hired")}
          {stat(
            p.stats.repeatHireRate !== null ? `${p.stats.repeatHireRate}%` : "—",
            "Rehired someone"
          )}
        </div>
        {p.stats.totalHires === 0 && (
          <p className="mt-2 text-xs text-gray-500">
            No hires through StaffVA yet — you may be their first.
          </p>
        )}
      </section>

      {/* Track record — only what the database can vouch for */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Track record
        </h2>
        <ul className="mt-3 space-y-2">
          <li className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
            {/* NOT "payment method on file" from stripe_customer_id — that id
                is minted the moment the funding modal is opened, charge or no
                charge. A completed escrow funding is a fact; a customer id is
                a click. */}
            <span className={`h-2 w-2 shrink-0 rounded-full ${p.trust.hasFundedEscrow ? "bg-green-500" : "bg-gray-300"}`} />
            <div>
              <p className="text-sm font-medium text-[#1C1B1A]">
                {p.trust.hasFundedEscrow ? "Has funded escrow" : "Hasn't funded an engagement yet"}
              </p>
              <p className="text-xs text-gray-500">
                {p.trust.hasFundedEscrow
                  ? "They've put real money into escrow through StaffVA."
                  : "Happens the first time they fund an engagement."}
              </p>
            </div>
          </li>
          <li className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
            <span className={`h-2 w-2 shrink-0 rounded-full ${p.trust.paymentsReleased > 0 ? "bg-green-500" : "bg-gray-300"}`} />
            <div>
              <p className="text-sm font-medium text-[#1C1B1A]">
                {p.trust.paymentsReleased > 0
                  ? `${p.trust.paymentsReleased} payment${p.trust.paymentsReleased === 1 ? "" : "s"} released through StaffVA`
                  : "No payments through StaffVA yet"}
              </p>
              <p className="text-xs text-gray-500">
                {/* True since the auto-release cron was scheduled alongside
                    this page: funded money leaves escrow when the client
                    releases it, or automatically at the period's deadline —
                    the route existed, but nothing called it until now. */}
                Money you earn sits in escrow once funded, and is released to
                you by the client or automatically at the deadline.
              </p>
            </div>
          </li>
          <li className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
            <span className={`h-2 w-2 shrink-0 rounded-full ${p.trust.contractsExecuted > 0 ? "bg-green-500" : "bg-gray-300"}`} />
            <div>
              <p className="text-sm font-medium text-[#1C1B1A]">
                {p.trust.contractsExecuted > 0
                  ? `${p.trust.contractsExecuted} contract${p.trust.contractsExecuted === 1 ? "" : "s"} signed by both sides`
                  : "No fully signed contracts yet"}
              </p>
              <p className="text-xs text-gray-500">{tenure}.</p>
            </div>
          </li>
        </ul>
      </section>

      {/* Reviews from candidates */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Reviews from people who worked with them
        </h2>
        {p.reviews.count === 0 ? (
          <p className="mt-3 rounded-xl border border-gray-200 bg-white px-4 py-4 text-sm text-gray-600">
            No reviews yet. Reviews open after money has actually moved on an
            engagement, and stay sealed until both sides have written theirs or
            the 30-day deadline passes.
          </p>
        ) : (
          <>
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
              <span className="text-3xl font-bold text-[#1C1B1A]">{p.reviews.average}</span>
              <div>
                <div className="text-amber-400" aria-label={`${p.reviews.average} out of 5`}>
                  {"★".repeat(Math.round(p.reviews.average ?? 0))}
                  <span className="text-gray-300">{"★".repeat(5 - Math.round(p.reviews.average ?? 0))}</span>
                </div>
                <p className="text-xs text-gray-500">
                  {p.reviews.count} review{p.reviews.count === 1 ? "" : "s"} from candidates
                  {p.reviews.count > p.reviews.items.length
                    ? ` · showing the latest ${p.reviews.items.length}`
                    : ""}
                </p>
              </div>
            </div>
            <ul className="mt-3 space-y-2">
              {p.reviews.items.map((r) => (
                <li key={r.id} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-amber-400 text-sm">
                      {"★".repeat(r.rating)}
                      <span className="text-gray-300">{"★".repeat(5 - r.rating)}</span>
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(r.submitted_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                    </span>
                  </div>
                  {r.body && <p className="mt-1.5 text-sm text-gray-700">{r.body}</p>}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <p className="mt-10 text-xs text-gray-400">
        {/* The NAME is self-reported (typed at signup, unverified) — a footnote
            vouching for everything would convert a disclaimer into an
            endorsement of whatever they typed. */}
        The numbers and reviews on this page come from activity on StaffVA. The
        company name is provided by the client and isn&apos;t verified.
      </p>
    </div>
  );
}
