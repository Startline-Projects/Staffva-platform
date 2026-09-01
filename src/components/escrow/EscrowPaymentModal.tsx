"use client";

import { useEffect, useRef, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";

/**
 * The escrow payment sheet — the missing half of /api/escrow/fund. The
 * server creates the PaymentIntent (amount + metadata decided there, never
 * here); this modal collects the payment method and confirms it. The
 * Stripe WEBHOOK is the only writer that marks anything funded, so on
 * success the UI says "payment received, escrow updating" and refreshes —
 * it never flips status itself.
 */

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
let stripePromise: Promise<Stripe | null> | null = null;
function getStripePromise() {
  if (!stripePromise && publishableKey) stripePromise = loadStripe(publishableKey);
  return stripePromise;
}

interface Props {
  engagementId: string;
  periodId?: string;
  milestoneId?: string;
  /** e.g. "Fund this period" / "Fund milestone: Design" */
  title: string;
  onClose: () => void;
  /** Called once payment is confirmed (webhook will finish the bookkeeping). */
  onPaid: () => void;
}

function CheckoutForm({ amountUsd, onPaid, onClose }: { amountUsd: number; onPaid: () => void; onClose: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [outcome, setOutcome] = useState<"succeeded" | "processing" | null>(null);
  const [error, setError] = useState("");

  async function pay() {
    if (!stripe || !elements || paying) return;
    setPaying(true);
    setError("");
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/team?funded=1` },
      redirect: "if_required",
    });
    setPaying(false);
    if (result.error) {
      setError(result.error.message || "Payment didn't go through — nothing was charged.");
      return;
    }
    const status = result.paymentIntent?.status;
    if (status === "succeeded" || status === "processing") {
      setOutcome(status);
      onPaid();
    } else {
      setError("Payment wasn't completed — nothing was charged. Try again.");
    }
  }

  if (outcome) {
    return (
      <div className="text-center">
        <p className="text-sm font-semibold text-text">
          {outcome === "succeeded" ? "Payment received" : "Payment initiated"}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-text-secondary">
          {outcome === "succeeded"
            ? "Your funds are in escrow — the period below updates to Funded in a moment, and it's released to the candidate when you approve the work (or 48 hours after the period ends)."
            : "Bank payments take a few business days to settle. We'll mark this Funded the moment the money arrives — no need to pay again; this payment is tracked."}
        </p>
        <button
          onClick={onClose}
          className="mt-4 rounded-lg bg-text px-4 py-2 text-sm font-semibold text-white"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div>
      <PaymentElement />
      <button
        onClick={pay}
        disabled={!stripe || paying}
        className="mt-4 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
      >
        {paying ? "Processing…" : `Pay $${amountUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
      </button>
      <p className="mt-2 text-center text-[11px] text-text-tertiary">
        Held in escrow by StaffVA · released when you approve the work
      </p>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export default function EscrowPaymentModal({ engagementId, periodId, milestoneId, title, onClose, onPaid }: Props) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [amountUsd, setAmountUsd] = useState(0);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const res = await fetch("/api/escrow/fund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engagementId, periodId, milestoneId }),
      });
      const data = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok || !data.clientSecret) {
        setError(data.error || "We couldn't start the payment — try again in a moment.");
        return;
      }
      setClientSecret(data.clientSecret);
      setAmountUsd(Number(data.amountUsd) || 0);
    }
    run().catch(() => {
      if (!cancelled) setError("We couldn't start the payment — check your connection and try again.");
    });
    return () => {
      cancelled = true;
    };
  }, [engagementId, periodId, milestoneId]);

  useEffect(() => {
    dialogRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const stripeReady = getStripePromise();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-sm font-semibold text-text">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-text-tertiary hover:text-text"
          >
            ✕
          </button>
        </div>

        {!publishableKey ? (
          <p className="mt-4 text-sm text-text-secondary">
            Payments aren&apos;t configured yet — the Stripe publishable key is
            missing. Nothing was charged.
          </p>
        ) : error ? (
          <p className="mt-4 text-sm text-red-600">{error}</p>
        ) : !clientSecret || !stripeReady ? (
          <p className="mt-4 text-sm text-text-tertiary">Preparing secure payment…</p>
        ) : (
          <div className="mt-4">
            <Elements stripe={stripeReady} options={{ clientSecret }}>
              <CheckoutForm amountUsd={amountUsd} onPaid={onPaid} onClose={onClose} />
            </Elements>
          </div>
        )}
      </div>
    </div>
  );
}
