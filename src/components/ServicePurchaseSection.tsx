"use client";

import { useState } from "react";

interface ServicePurchaseSectionProps {
  packageId: string;
  packageTitle: string;
  packagePrice: number;
  deliveryDays: number;
  whatsIncluded: string[];
  candidateName: string;
}

export default function ServicePurchaseSection({
  packageId,
  packageTitle,
  packagePrice,
  deliveryDays,
  whatsIncluded,
  candidateName,
}: ServicePurchaseSectionProps) {
  const [showModal, setShowModal] = useState(false);
  const [requirements, setRequirements] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const platformFee = Math.round(packagePrice * 10) / 100;
  const total = packagePrice + platformFee;

  async function handlePurchase() {
    if (requirements.length < 20) {
      setError("Please describe your requirements (at least 20 characters).");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/services/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId, requirements }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create checkout session");
        setLoading(false);
        return;
      }

      // Redirect to Stripe Checkout
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-white hover:bg-orange-600 transition-colors"
      >
        Buy Now
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-text">Purchase Service</h2>
              <button
                onClick={() => {
                  setShowModal(false);
                  setError("");
                  setRequirements("");
                }}
                className="text-text/40 hover:text-text"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mt-4 rounded-lg bg-gray-50 p-4">
              <h3 className="font-semibold text-text">{packageTitle}</h3>
              <p className="text-sm text-text/60 mt-1">by {candidateName}</p>
              <p className="text-xs text-text/50 mt-1">Delivery in {deliveryDays} day{deliveryDays !== 1 ? "s" : ""}</p>

              <div className="mt-3 space-y-1">
                {whatsIncluded.map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-text/70">
                    <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-text">
                Your Requirements *
              </label>
              <textarea
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
                placeholder="Describe your specific needs in detail (min 20 characters)..."
                rows={4}
                maxLength={500}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-text/40">{requirements.length}/500</p>
            </div>

            <div className="mt-4 rounded-lg border border-gray-200 p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-text/60">Service price</span>
                <span className="text-text">${packagePrice.toFixed(2)}</span>
              </div>
              <div className="border-t border-gray-200 pt-2 flex justify-between">
                <span className="font-semibold text-text">Total</span>
                <span className="font-bold text-primary text-lg">${total.toFixed(2)}</span>
              </div>
              <p className="text-[10px] text-text/30">Your payment is held in escrow until you approve.</p>
            </div>

            {error && (
              <p className="mt-3 text-sm text-red-600">{error}</p>
            )}

            <div className="mt-5 flex gap-3">
              <button
                onClick={handlePurchase}
                disabled={loading}
                className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "Processing..." : `Pay $${total.toFixed(2)}`}
              </button>
              <button
                onClick={() => {
                  setShowModal(false);
                  setError("");
                  setRequirements("");
                }}
                className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-text hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>

            <p className="mt-3 text-center text-[10px] text-text/30">
              Payment processed securely by Stripe. Funds held until delivery approved.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
