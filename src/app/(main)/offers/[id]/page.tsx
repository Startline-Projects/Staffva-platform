"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";

interface Offer {
  id: string;
  hourly_rate: number;
  hours_per_week: number;
  contract_length: string;
  start_date: string;
  signing_bonus_usd: number | null;
  personal_message: string | null;
  estimated_monthly_cost: number;
  status: string;
  sent_at: string;
  clients: { full_name: string; company_name: string | null } | null;
}

export default function OfferResponsePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState(false);
  const [responded, setResponded] = useState<"accepted" | "declined" | null>(null);

  useEffect(() => {
    async function load() {
      // Through the API, not a direct table read: RLS on `clients` nulls the
      // join for a candidate viewer, which rendered every offer as coming
      // from "A client" — an accept/decline decision on a binding engagement
      // made against an anonymous counterparty. GET /api/offers reads with
      // the service role, scoped to the caller's own offers, and returns the
      // client's name the way every other candidate surface shows it.
      const res = await fetch("/api/offers");
      const j = res.ok ? await res.json() : { offers: [] };
      const data = (j.offers || []).find((o: { id: string }) => o.id === id) ?? null;
      if (data) {
        setOffer(data as unknown as Offer);
        // Mark as viewed
        if (data.status === "sent") {
          fetch("/api/offers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "mark_viewed", offerId: id }) });
        }
        if (data.status === "accepted") setResponded("accepted");
        if (data.status === "declined") setResponded("declined");
      }
      setLoading(false);
    }
    load();
  }, [id]);

  async function handleRespond(response: "accept" | "decline") {
    setResponding(true);
    const res = await fetch("/api/offers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "respond", offerId: id, response }) });
    const data = await res.json();
    if (data.success) {
      setResponded(data.status);
      if (data.status === "accepted") setTimeout(() => router.push("/candidate/dashboard"), 2000);
    }
    setResponding(false);
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  if (!offer) return <div className="py-20 text-center text-text-muted">Offer not found</div>;

  const expiryDate = new Date(new Date(offer.sent_at).getTime() + 5 * 24 * 60 * 60 * 1000);
  // Expiry is a STATUS, not a clock reading. /api/cron/expire-offers flips it
  // once daily at 12:00 UTC, and the accept CAS in /api/offers honours
  // sent/viewed with no time predicate — so ticking here refused an acceptance
  // the server would have taken. It also contradicted the offer card on
  // /candidate/work, which is the only surface an offer reaches a candidate
  // through while candidate email is frozen, and it made this page disagree
  // with itself: the tick only applied to status 'sent', so the same
  // past-deadline offer showed "expired" before the page marked it viewed and
  // Accept/Decline immediately after. expiryDate is still used for the
  // "respond by" line below, which stays true.
  const isExpired = offer.status === "expired";
  const clientCo = offer.clients as Offer["clients"] | null;
  const clientName = clientCo?.company_name || clientCo?.full_name || "A client";
  const company = (offer.clients as Offer["clients"])?.company_name;

  return (
    <div className="mx-auto max-w-lg px-6 py-12">
      {responded === "accepted" && (
        <div className="mb-6 rounded-2xl bg-green-50 border border-green-200 p-6 text-center">
          <p className="text-lg font-semibold text-green-800">Offer accepted!</p>
          <p className="mt-1 text-sm text-green-700">Redirecting to your dashboard...</p>
        </div>
      )}

      {responded === "declined" && (
        <div className="mb-6 rounded-2xl bg-gray-50 border border-border-light p-6 text-center">
          <p className="text-lg font-semibold text-text">Offer declined</p>
          <p className="mt-1 text-sm text-text-muted">The client has been notified.</p>
        </div>
      )}

      <div className="rounded-2xl border border-border-light bg-card p-6">
        <p className="text-xs text-text-tertiary uppercase tracking-widest">Offer from</p>
        <h1 className="mt-1 text-xl font-semibold text-text">{clientName}</h1>
        {company && <p className="text-sm text-text-muted">{company}</p>}

        <div className="mt-6 space-y-3 text-sm">
          <div className="flex justify-between border-b border-border-light pb-3">
            <span className="text-text-muted">Hourly Rate</span>
            <span className="font-semibold text-text">${offer.hourly_rate}/hr</span>
          </div>
          <div className="flex justify-between border-b border-border-light pb-3">
            <span className="text-text-muted">Hours Per Week</span>
            <span className="text-text">{offer.hours_per_week}</span>
          </div>
          <div className="flex justify-between border-b border-border-light pb-3">
            <span className="text-text-muted">Contract Length</span>
            <span className="text-text">{offer.contract_length}</span>
          </div>
          <div className="flex justify-between border-b border-border-light pb-3">
            <span className="text-text-muted">Start Date</span>
            <span className="text-text">{new Date(offer.start_date + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
          </div>
          {offer.signing_bonus_usd && Number(offer.signing_bonus_usd) > 0 && (
            <div className="flex justify-between border-b border-border-light pb-3">
              <span className="text-text-muted">Signing Bonus</span>
              <span className="text-text">${Number(offer.signing_bonus_usd).toFixed(0)}</span>
            </div>
          )}
        </div>

        {offer.personal_message && (
          <div className="mt-6 rounded-xl bg-background p-4">
            <p className="text-xs text-text-tertiary uppercase tracking-widest mb-2">Message from {clientName}</p>
            <p className="text-sm text-text leading-relaxed italic">&ldquo;{offer.personal_message}&rdquo;</p>
          </div>
        )}

        {!responded && !isExpired && (
          <div className="mt-6 flex gap-3">
            <button onClick={() => handleRespond("decline")} disabled={responding}
              className="flex-1 rounded-full border border-border py-3 text-sm font-medium text-text hover:border-text transition-colors disabled:opacity-50">
              Decline
            </button>
            <button onClick={() => handleRespond("accept")} disabled={responding}
              className="flex-1 rounded-full bg-primary py-3 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-50">
              {responding ? "Processing..." : "Accept Offer"}
            </button>
          </div>
        )}

        {isExpired && !responded && (
          <div className="mt-6 rounded-xl bg-gray-50 p-4 text-center">
            <p className="text-sm text-text-muted">This offer has expired.</p>
          </div>
        )}

        {!responded && !isExpired && (
          <p className="mt-4 text-center text-xs text-text-tertiary">
            Respond by {expiryDate.toLocaleDateString("en-US", { month: "long", day: "numeric" })}
          </p>
        )}
      </div>
    </div>
  );
}
