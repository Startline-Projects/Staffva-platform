"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";

/**
 * Verify to fund — Atlas step 13, cut to what actually happens.
 *
 * Two real steps, not the prototype's five. The document and the selfie are
 * collected by Stripe Identity's own hosted flow, so there are no local
 * upload boxes here pretending to take them; the card is saved with a
 * SetupIntent, which is why "$0 charged today" is a mechanical fact rather
 * than a reassurance — a SetupIntent has no amount.
 *
 * Cut on record from the prototype's copy: "5 minutes" (a duration nobody
 * measured), "authorize at signature, capture per pay period" (card
 * authorisations expire in about a week — the mechanics don't exist),
 * "verification unlocks contract sending" (false here by the owner's own
 * decision: it unlocks funding and nothing else), and the claim that the
 * selfie video is "discarded after verification", which is Stripe's
 * retention policy to state, not ours.
 */

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
let stripePromise: Promise<Stripe | null> | null = null;
function getStripePromise() {
  if (!stripePromise && publishableKey) stripePromise = loadStripe(publishableKey);
  return stripePromise;
}

interface Card {
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
}

function CardForm({ onSaved }: { onSaved: (card: Card) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setError("");
    const result = await stripe.confirmSetup({ elements, redirect: "if_required" });
    if (result.error) {
      setError(result.error.message || "That card couldn't be saved.");
      setBusy(false);
      return;
    }
    // The server reads the card off Stripe rather than trusting anything
    // this browser says about it.
    const res = await fetch("/api/client/payment-method", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setupIntentId: result.setupIntent?.id }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "We couldn't save that card. Try again.");
      return;
    }
    onSaved(data.card);
  }

  return (
    <form onSubmit={submit}>
      <PaymentElement options={{ layout: "tabs" }} />
      <button type="submit" className="vf-btn vf-btn-primary" disabled={!stripe || busy} style={{ marginTop: 18 }}>
        {busy ? "Saving…" : "Save card"}
      </button>
      {error && <p className="vf-error" role="alert">{error}</p>}
    </form>
  );
}

export default function VerifyToFund({
  status: initialStatus,
  humanReviewed,
  card: initialCard,
}: {
  status: string;
  humanReviewed: boolean;
  card: Card | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState(initialStatus);
  const [card, setCard] = useState<Card | null>(initialCard);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stripeReady, setStripeReady] = useState<Promise<Stripe | null> | null>(null);
  const [pollGaveUp, setPollGaveUp] = useState(false);

  // Only used to explain the wait on the return trip; the poll itself no
  // longer depends on it.
  const returning = searchParams.get("id_check") === "returning";

  // A pending check is resolved by a webhook that has usually not landed
  // yet, so poll our own status endpoint (which reconciles against Stripe).
  //
  // Polls on ANY pending status, not only on the return trip: someone who
  // closed the Stripe tab and came back later through the banner arrives
  // without ?id_check=returning, and the first draft showed them "the page
  // updates on its own" while never issuing a request. It also stops
  // claiming that once it gives up — review caught both halves.
  useEffect(() => {
    if (status !== "pending") return;
    let cancelled = false;
    let tries = 0;
    const t = setInterval(async () => {
      tries += 1;
      try {
        const res = await fetch("/api/client/identity/status");
        if (res.ok) {
          const j = await res.json();
          if (cancelled) return;
          if (j.card) setCard(j.card);
          if (j.status && j.status !== status) {
            setStatus(j.status);
            // The shell's banner is computed in a server layout, which does
            // not re-render on its own — without this it keeps prompting for
            // something already done.
            router.refresh();
            clearInterval(t);
            return;
          }
        }
      } catch {
        /* keep the last known state */
      }
      // ~2 minutes, then stop and say so rather than spinning forever.
      if (tries >= 40) {
        clearInterval(t);
        if (!cancelled) setPollGaveUp(true);
      }
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [status, router]);

  async function startIdentity() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/client/identity/create-session", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "We couldn't start verification. Try again in a moment.");
        return;
      }
      if (data.alreadyVerified) {
        setStatus("passed");
        return;
      }
      if (data.url) window.location.href = data.url;
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function startCard() {
    if (busy || clientSecret) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/client/payment-method", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.clientSecret) {
        setError(data.error || "We couldn't start card setup. Try again in a moment.");
        return;
      }
      setStripeReady(getStripePromise());
      setClientSecret(data.clientSecret);
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const idDone = status === "passed";
  const cardDone = !!card?.last4;
  const allDone = idDone && cardDone;

  return (
    <section className="vf-wrap">
      <header className="vf-header">
        <span className="vf-eyebrow">Verify to fund</span>
        <h1>
          Verify once, then <em>fund your hires</em>.
        </h1>
        <p className="vf-lead">
          Browsing, messaging, interviewing, sending proposals and signing
          contracts are all open to you right now. Verification and a card on
          file are what let you move money into escrow — that is the only
          thing they unlock.
        </p>
      </header>

      {allDone ? (
        <div className="vf-card vf-done">
          <h2>You&apos;re set.</h2>
          <p>
            Your identity is verified and{" "}
            {card?.brand ? `your ${card.brand} ending ${card.last4}` : "your card"} is on file. You
            can fund payment periods and milestones from your engagements.
          </p>
          <button type="button" className="vf-btn vf-btn-primary" onClick={() => router.push("/team#engagements")}>
            Go to your engagements
          </button>
        </div>
      ) : null}

      {/* ── Step 1: identity ── */}
      <div className={`vf-card${idDone ? " vf-complete" : ""}`}>
        <div className="vf-card-head">
          <span className="vf-step-num">{idDone ? "✓" : "1"}</span>
          <div>
            <h2>Verify your identity</h2>
            <p className="vf-card-sub">
              {/* NOT "the same check every candidate has passed": candidates
                  stay visible to clients for a grace window while their own
                  check is pending, and some are live with it unresolved.
                  Claiming otherwise would tell a client something false
                  about who they are browsing. */}
              A government ID and a matching selfie, checked by Stripe — the
              same verification StaffVA asks candidates for.
            </p>
          </div>
        </div>

        {idDone ? (
          <p className="vf-status vf-status-ok">Verified.</p>
        ) : humanReviewed ? (
          <p className="vf-status vf-status-hold">
            Our team reviewed this verification, so it can&apos;t be restarted from
            here. Email <a href="mailto:support@staffva.com">support@staffva.com</a> and
            we&apos;ll sort it out.
          </p>
        ) : status === "manual_review" ? (
          <p className="vf-status vf-status-hold">
            Being reviewed by our team — nothing more to do here. If you
            haven&apos;t heard back, email{" "}
            <a href="mailto:support@staffva.com">support@staffva.com</a> and
            we&apos;ll chase it.
          </p>
        ) : status === "pending" ? (
          <>
            <p className="vf-status vf-status-pending">
              {pollGaveUp
                ? "Still waiting on Stripe's result. Refresh this page to check again, or start the check over."
                : returning
                  ? "Waiting on Stripe's result. This usually takes a moment; the page updates on its own."
                  : "Your check is in progress. This page updates on its own while it's open."}
            </p>
            <button type="button" className="vf-btn" onClick={startIdentity} disabled={busy}>
              Start again
            </button>
          </>
        ) : (
          <>
            {status === "failed" && (
              <p className="vf-status vf-status-fail">
                That check didn&apos;t go through — usually an unclear photo or an
                unsupported document. You can try again.
              </p>
            )}
            <label className="vf-consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                {/* The candidate consent's exact wording, because it is the
                    accurate one: StaffVA stores the session reference, which
                    IS a retrieval key for what Stripe holds. "We never
                    receive the images" would have been a stronger claim than
                    the code supports. */}
                I agree to verify my identity with Stripe, which will collect
                and check my government ID and a selfie. StaffVA stores the
                result and a reference to the Stripe session — not the
                document images themselves.
              </span>
            </label>
            <button
              type="button"
              className="vf-btn vf-btn-primary"
              onClick={startIdentity}
              disabled={!consent || busy}
            >
              {busy ? "Starting…" : "Verify with Stripe"}
            </button>
          </>
        )}
      </div>

      {/* ── Step 2: card ── */}
      <div className={`vf-card${cardDone ? " vf-complete" : ""}`}>
        <div className="vf-card-head">
          <span className="vf-step-num">{cardDone ? "✓" : "2"}</span>
          <div>
            <h2>Put a card on file</h2>
            <p className="vf-card-sub">
              {/* Two things review caught in the first draft: "for that
                  amount" hid the 10% platform fee the funding charge adds,
                  and "you are charged" implied this card is the one charged
                  — funding still collects a payment method in its own sheet
                  today. Both are stated as they actually work. */}
              <strong>$0 is charged today.</strong> This saves the card and
              authorises nothing. Money moves only when you choose to fund a
              payment period or milestone — at that point you confirm the
              payment, and the charge is the amount plus StaffVA&apos;s 10%
              platform fee.
            </p>
          </div>
        </div>

        {cardDone && !clientSecret ? (
          <>
            <p className="vf-status vf-status-ok">
              {card?.brand ? `${card.brand} ending ${card.last4}` : `Card ending ${card?.last4}`}
              {card?.expMonth && card?.expYear
                ? ` · expires ${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}`
                : ""}
            </p>
            {/* A card that expires or is closed would otherwise leave the
                client stuck: the banner stays away (a card id is on file),
                and nothing else in the product replaces one yet. */}
            <button type="button" className="vf-btn" onClick={startCard} disabled={busy} style={{ marginTop: 14 }}>
              {busy ? "Starting…" : "Replace card"}
            </button>
          </>
        ) : !publishableKey ? (
          <p className="vf-status vf-status-hold">
            Card setup isn&apos;t available right now. Email{" "}
            <a href="mailto:support@staffva.com">support@staffva.com</a> and we&apos;ll
            help.
          </p>
        ) : clientSecret && stripeReady ? (
          <Elements stripe={stripeReady} options={{ clientSecret }}>
            <CardForm
              onSaved={(c) => {
                setCard(c);
                setClientSecret(null);
                // Same reason as the identity poll: the banner lives in a
                // server layout that will not re-render by itself.
                router.refresh();
              }}
            />
          </Elements>
        ) : (
          <button type="button" className="vf-btn vf-btn-primary" onClick={startCard} disabled={busy}>
            {busy ? "Starting…" : "Add a card"}
          </button>
        )}
      </div>

      {error && (
        <p className="vf-error" role="alert">
          {error}
        </p>
      )}

      <p className="vf-foot">
        Payments and identity checks are handled by Stripe. StaffVA never sees
        or stores your card number.
      </p>
    </section>
  );
}
