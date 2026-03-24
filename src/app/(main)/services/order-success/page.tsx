"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function OrderSuccessPage() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [loading, setLoading] = useState(true);
  const [orderDetails, setOrderDetails] = useState<{
    packageTitle: string;
    candidateName: string;
    deliveryDays: number;
    amount: number;
  } | null>(null);

  useEffect(() => {
    async function confirmOrder() {
      if (!sessionId) {
        setLoading(false);
        return;
      }

      // Update order status from pending to in_progress
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      // Fetch the client's most recent pending order to confirm it
      const res = await fetch("/api/services/orders?role=client");
      const data = await res.json();

      if (data.orders && data.orders.length > 0) {
        const latestOrder = data.orders.find(
          (o: Record<string, unknown>) => o.status === "pending" || o.status === "in_progress"
        );

        if (latestOrder) {
          // If still pending, mark as in_progress
          if (latestOrder.status === "pending") {
            await fetch("/api/services/orders", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                orderId: latestOrder.id,
                action: "confirm_payment",
              }),
            }).catch(() => {
              // If confirm_payment action doesn't exist, that's ok
              // The webhook will handle it
            });
          }

          const pkg = latestOrder.service_packages as { title: string; delivery_days: number } | null;
          const cand = latestOrder.candidates as { display_name: string } | null;

          setOrderDetails({
            packageTitle: pkg?.title || "Service",
            candidateName: cand?.display_name || "Professional",
            deliveryDays: pkg?.delivery_days || 7,
            amount: Number(latestOrder.amount_paid_usd),
          });
        }
      }

      setLoading(false);
    }

    confirmOrder();
  }, [sessionId]);

  if (loading) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="mt-4 text-text/60">Confirming your order...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
        <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <h1 className="mt-6 text-2xl font-bold text-text">Order Confirmed!</h1>

      {orderDetails ? (
        <>
          <p className="mt-3 text-text/60">
            Your order for <strong>{orderDetails.packageTitle}</strong> with{" "}
            <strong>{orderDetails.candidateName}</strong> has been placed successfully.
          </p>

          <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5 text-left">
            <div className="flex justify-between border-b border-gray-100 pb-3">
              <span className="text-sm text-text/60">Service</span>
              <span className="text-sm font-medium text-text">{orderDetails.packageTitle}</span>
            </div>
            <div className="flex justify-between border-b border-gray-100 py-3">
              <span className="text-sm text-text/60">Professional</span>
              <span className="text-sm font-medium text-text">{orderDetails.candidateName}</span>
            </div>
            <div className="flex justify-between border-b border-gray-100 py-3">
              <span className="text-sm text-text/60">Expected delivery</span>
              <span className="text-sm font-medium text-text">
                {orderDetails.deliveryDays} day{orderDetails.deliveryDays !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex justify-between pt-3">
              <span className="text-sm font-medium text-text">Total paid</span>
              <span className="text-lg font-bold text-primary">
                ${orderDetails.amount.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="mt-6 rounded-xl bg-blue-50 p-4 text-left">
            <h3 className="text-sm font-semibold text-blue-800">What happens next</h3>
            <ul className="mt-2 space-y-2 text-sm text-blue-700">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-blue-500">1.</span>
                The professional has been notified and will begin working on your order.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-blue-500">2.</span>
                You will receive an email when the delivery is ready for your review.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-blue-500">3.</span>
                Review the delivery and approve to release payment, or request a revision.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-blue-500">4.</span>
                If no action is taken within 7 days of delivery, funds auto-release.
              </li>
            </ul>
          </div>
        </>
      ) : (
        <p className="mt-3 text-text/60">
          Your payment was successful. The professional will be notified and begin working on your order.
        </p>
      )}

      <div className="mt-8 flex justify-center gap-4">
        <Link
          href="/services"
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-600"
        >
          View My Orders
        </Link>
        <Link
          href="/browse"
          className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-text hover:bg-gray-50"
        >
          Browse More Talent
        </Link>
      </div>
    </div>
  );
}
