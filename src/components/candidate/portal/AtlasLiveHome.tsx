import Link from "next/link";
import AvailabilityBar from "./AvailabilityBar";
import AvailabilityRateCard from "@/components/candidate/AvailabilityRateCard";
import GoingLiveWelcome from "@/components/candidate/GoingLiveWelcome";
import {
  computeVisibility,
  availabilityIsStale,
  type VisibilityInput,
} from "@/lib/candidateVisibility";

/**
 * The Atlas live-mode dashboard home, in the prototype's order: greeting →
 * availability bar → stats row → recent activity → resources — with our
 * action cards (offer waiting / contract to sign / flagged contract / open
 * review) slotted between the greeting and the bar, because with candidate
 * email frozen these cards are the only way those events reach a person, and
 * nothing may push them below the fold.
 *
 * This replaces LivePortal. Everything it carried is either here (greeting,
 * action cards, visibility reasons, availability editor, going-live welcome)
 * or in the shell's sidebar (the quick links).
 */

export interface ActivityItem {
  kind: "view" | "message" | "offer";
  label: string;
  at: string;
}

export default function AtlasLiveHome({
  candidate,
  firstName,
  noticeEngagement = null,
  pendingOfferCount,
  signableContractCount,
  flaggedContractCount,
  openReviewCount,
  views7d,
  unreadMessages,
  activeEngagements,
  activity,
}: {
  candidate: VisibilityInput & {
    id: string;
    hourly_rate?: number | null;
    hours_per_week?: number | null;
    availability_date?: string | null;
    going_live_ack_at?: string | null;
  };
  firstName: string;
  pendingOfferCount: number;
  signableContractCount: number;
  flaggedContractCount: number;
  openReviewCount: number;
  views7d: number;
  unreadMessages: number;
  activeEngagements: number;
  noticeEngagement?: { id: string; ends_at: string; notice_given_by: string | null } | null;
  activity: ActivityItem[];
}) {
  const vis = computeVisibility(candidate);
  const stale = availabilityIsStale(candidate);
  const reasons = [...vis.reasons].sort(
    (a, b) => Number(b.hidesFromSearch) - Number(a.hidesFromSearch)
  );

  const stat = (n: number) => (
    <div className={`live-stat-num${n === 0 ? " zero" : ""}`}>{n}</div>
  );

  return (
    <>
      {/* Gated on the same predicate as everything else on the page: the
          welcome asserts "clients can now find you", so it must not greet an
          ID-overdue candidate whom the marketplace query excludes. */}
      {!candidate.going_live_ack_at && vis.searchable && (
        <GoingLiveWelcome firstName={firstName} />
      )}

      {/* ── Greeting ── */}
      <section className="live-greeting" style={{ display: "block" }}>
        <div className="live-greeting-eyebrow">
          {vis.searchable ? "You're live on StaffVA" : "Approved · currently hidden"}
        </div>
        <h1 className="live-greeting-title">
          Welcome, <em>{firstName}</em>.
        </h1>
        <p className="live-greeting-sub">
          {vis.searchable
            ? "Your profile is searchable. We'll notify you here when something happens."
            : "Your profile is approved, but it's hidden from search right now — the reason and the fix are below."}
        </p>
      </section>

      {/* ── Action cards — the email freeze makes these the delivery ── */}
      {pendingOfferCount > 0 && (
        <section className="mb-6 rounded-lg border border-[#FE6E3E] bg-orange-50 p-5">
          <h2 className="text-base font-bold text-[#1C1B1A]">
            {pendingOfferCount === 1
              ? "You have an offer waiting."
              : `You have ${pendingOfferCount} offers waiting.`}
          </h2>
          <p className="mt-1 text-sm text-gray-700">
            A client wants to work with you. Have a look and give them an answer.
          </p>
          <Link
            href="/candidate/work"
            className="mt-3 inline-block rounded-full bg-[#FE6E3E] px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#E55A2B]"
          >
            Review it
          </Link>
        </section>
      )}

      {signableContractCount > 0 && (
        <section className="mb-6 rounded-lg border border-[#FE6E3E] bg-orange-50 p-5">
          <h2 className="text-base font-bold text-[#1C1B1A]">
            {signableContractCount === 1
              ? "A contract is waiting for your signature."
              : `${signableContractCount} contracts are waiting for your signature.`}
          </h2>
          <p className="mt-1 text-sm text-gray-700">
            Read it through and sign when you&apos;re happy with the terms.
          </p>
          <Link
            href="/candidate/contracts"
            className="mt-3 inline-block rounded-full bg-[#FE6E3E] px-6 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#E55A2B]"
          >
            Review it
          </Link>
        </section>
      )}

      {/* Separate from the card above, deliberately. "There's a problem" and
          "please sign" are different messages and must never be merged: a
          flagged contract is one nobody should sign yet. */}
      {flaggedContractCount > 0 && (
        <section className="mb-6 rounded-lg border border-red-200 bg-red-50 p-5">
          <h2 className="text-base font-bold text-red-900">
            There&apos;s a problem with a contract you were sent.
          </h2>
          <p className="mt-1 text-sm text-red-800">
            The pay terms in it don&apos;t match your engagement, so it can&apos;t
            be signed. Our team has been alerted. Nothing for you to do.
          </p>
          <Link
            href="/candidate/contracts"
            className="mt-3 inline-block text-sm font-semibold text-red-900 underline hover:no-underline"
          >
            See the details
          </Link>
        </section>
      )}

      {/* An engagement in its 14-day notice period — the one date a working
          candidate must not discover late. */}
      {noticeEngagement && (
        <section className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-base font-bold text-amber-900">
            {noticeEngagement.notice_given_by === "candidate"
              ? "You've given 14 days' notice on an engagement."
              : "A client has given 14 days' notice on your engagement."}
          </h2>
          <p className="mt-1 text-sm text-amber-800">
            It ends on{" "}
            <strong>
              {new Date(noticeEngagement.ends_at).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
                timeZone: "UTC",
              })}
            </strong>
            . Work and pay continue until then; funded money follows the normal
            release process.
          </p>
          <Link
            href="/candidate/contracts"
            className="mt-3 inline-block text-sm font-semibold text-amber-900 underline hover:no-underline"
          >
            See the agreement
          </Link>
        </section>
      )}

      {openReviewCount > 0 && (
        <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-base font-bold text-[#1C1B1A]">
            {openReviewCount === 1
              ? "You can review a client you've worked with."
              : `You can review ${openReviewCount} clients you've worked with.`}
          </h2>
          <p className="mt-1 text-sm text-gray-700">
            Neither review is visible until you&apos;ve both submitted, or 30 days
            pass — so what you write can&apos;t affect what they write.
          </p>
          <Link
            href="/candidate/reviews"
            className="mt-3 inline-block rounded-full border border-gray-300 px-6 py-2 text-sm font-semibold text-[#1C1B1A] transition-colors hover:border-[#1C1B1A]"
          >
            Write it
          </Link>
        </section>
      )}

      {/* ── Availability bar + why-you're-hidden, one unit ── */}
      <AvailabilityBar
        status={candidate.availability_status ?? null}
        hourlyRate={candidate.hourly_rate ?? null}
        hoursPerWeek={candidate.hours_per_week ?? null}
        availabilityDate={candidate.availability_date ?? null}
      />
      {reasons.length > 0 && (
        <ul className="mb-6 mt-3 space-y-2.5">
          {reasons.map((r) => (
            <li
              key={r.kind}
              className={`rounded-lg border p-3 ${
                r.hidesFromSearch
                  ? "border-red-200 bg-red-50"
                  : r.kind === "on_contract"
                    ? "border-gray-200 bg-gray-50"
                    : "border-amber-200 bg-amber-50"
              }`}
            >
              <p className={`text-sm font-medium ${r.hidesFromSearch ? "text-red-800" : r.kind === "on_contract" ? "text-gray-800" : "text-amber-900"}`}>
                {r.title}
              </p>
              <p className={`mt-0.5 text-sm ${r.hidesFromSearch ? "text-red-700" : r.kind === "on_contract" ? "text-gray-600" : "text-amber-800"}`}>
                {r.detail}
              </p>
              {r.action && (
                <Link href={r.action.href} className="mt-1.5 inline-block text-sm font-semibold text-[#FE6E3E] hover:underline">
                  {r.action.label} →
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* ── Stats row ── */}
      <div className="live-stats-row" style={{ display: "grid" }}>
        <div className="live-stat-card">
          {stat(views7d)}
          {/* Distinct viewers, not view events: profile_views keeps one row
              per client (an upsert bumps viewed_at), so counting "views" from
              it would understate repeat interest under a label that promises
              otherwise. */}
          <div className="live-stat-label">Profile viewers · 7d</div>
        </div>
        <div className="live-stat-card">
          {stat(unreadMessages)}
          <div className="live-stat-label">New messages</div>
        </div>
        <div className="live-stat-card">
          {stat(activeEngagements)}
          <div className="live-stat-label">Active engagements</div>
        </div>
      </div>

      {/* ── Recent activity ── */}
      <div className="live-recent-card" style={{ display: "block" }}>
        <div className="ur-card-header">
          <h3>Recent activity</h3>
          <span className="ur-card-meta">Last 7 days</span>
        </div>
        {activity.length === 0 ? (
          <div className="live-recent-empty">
            <span className="empty-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.4" />
                <path d="M9 5v4l2.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <div>
              <strong>Nothing yet</strong>
              {/* Not "send you a message": clients have no channel to message
                  candidates directly, so the feed can only ever show views,
                  offers, and staff messages — promise exactly those. */}
              When clients view your profile or send you an offer, it shows up
              here.
            </div>
          </div>
        ) : (
          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
            {activity.map((a, i) => (
              <li key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13.5 }}>
                <span>{a.label}</span>
                <span style={{ color: "var(--ink-mute)", fontSize: 12, whiteSpace: "nowrap" }}>
                  {new Date(a.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Availability & rate editor (the resources card links here) ── */}
      <div id="availability" className="mt-6">
        {/* Keyed on the server values: the editor seeds useState from props at
            mount, so without the key a pause made in the bar above would sit
            in this form as stale "available_now" and the next Save would
            silently undo it. The key forces a remount on every server-visible
            change. */}
        <AvailabilityRateCard
          key={`${candidate.availability_status}|${candidate.availability_date}|${candidate.hourly_rate}|${candidate.hours_per_week}`}
          status={candidate.availability_status ?? "available_now"}
          date={candidate.availability_date ?? null}
          rate={candidate.hourly_rate ?? null}
          hoursPerWeek={candidate.hours_per_week ?? null}
          lastUpdated={candidate.availability_last_updated_at ?? null}
          stale={stale}
        />
      </div>

      {/* ── Getting started ── */}
      <div className="live-resources-card" style={{ display: "block" }}>
        <div className="ur-card-header">
          <h3>Getting started on StaffVA</h3>
          <span className="ur-card-meta">The essentials</span>
        </div>
        <ul className="live-resource-list">
          <li>
            <a href="#availability" className="live-resource-item">
              <span className="live-resource-icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2v12M4 6l4-4 4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="live-resource-text">Set your rate and availability — clients filter on both</span>
              <svg className="live-resource-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </li>
          <li>
            <Link href="/candidate/availability" className="live-resource-item">
              <span className="live-resource-icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M2 6h12" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </span>
              <span className="live-resource-text">Publish interview hours so clients can book a call</span>
              <svg className="live-resource-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </li>
          <li>
            <a href="#payouts" className="live-resource-item">
              <span className="live-resource-icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2v12M4.5 5h5a2 2 0 0 1 0 4h-3a2 2 0 0 0 0 4h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </span>
              <span className="live-resource-text">Set up payouts before your first escrow release</span>
              <svg className="live-resource-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          </li>
          <li>
            <Link href={`/candidate/${candidate.id}`} className="live-resource-item">
              <span className="live-resource-icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="6" r="2.8" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M3 14c.4-2.6 2.5-4 5-4s4.6 1.4 5 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </span>
              <span className="live-resource-text">See your public profile the way clients see it</span>
              <svg className="live-resource-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </li>
        </ul>
      </div>
    </>
  );
}
