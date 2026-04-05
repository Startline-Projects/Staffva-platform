"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface EscrowItem {
  type: "payment_period" | "milestone" | "service_order";
  id: string;
  engagement_id?: string;
  candidate_name?: string;
  client_name?: string;
  amount_usd: number;
  status: string;
  funded_at: string | null;
  auto_release_at: string | null;
  period_start?: string;
  period_end?: string;
  title?: string;
  submitted_at?: string | null;
}

interface EscrowData {
  escrow: EscrowItem[];
  total_in_escrow: number;
  count: number;
}

// Format UTC date to user's local timezone — all dates come from server UTC
function formatDate(utcDate: string): string {
  const d = new Date(utcDate);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function formatShortDate(utcDate: string): string {
  const d = new Date(utcDate);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function timeUntil(utcDate: string): string {
  const now = new Date();
  const target = new Date(utcDate);
  const diff = target.getTime() - now.getTime();
  if (diff <= 0) return "any moment now";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return `in ${days}d ${hours}h`;
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `in ${hours}h ${minutes}m`;
}

function getStatusMessage(item: EscrowItem, role: "client" | "candidate"): string {
  if (item.type === "payment_period") {
    if (role === "client") {
      const releaseInfo = item.auto_release_at
        ? `Auto-releases ${formatDate(item.auto_release_at)} unless disputed.`
        : `Releases at end of period unless disputed.`;
      return `Funds held in escrow. ${releaseInfo}`;
    } else {
      const releaseInfo = item.auto_release_at
        ? `Releases to you on ${formatDate(item.auto_release_at)} unless disputed.`
        : `Releases to you at end of period.`;
      return `Payment period funded. ${releaseInfo}`;
    }
  }

  if (item.type === "milestone") {
    if (item.status === "candidate_marked_complete") {
      if (role === "client") {
        const releaseInfo = item.auto_release_at
          ? `Auto-releases to candidate on ${formatDate(item.auto_release_at)} if no action taken.`
          : `Review and approve or dispute.`;
        return `Milestone submitted for review. ${releaseInfo}`;
      } else {
        const releaseInfo = item.auto_release_at
          ? `Auto-releases on ${formatDate(item.auto_release_at)} if client takes no action.`
          : `Waiting for client approval.`;
        return `Milestone marked complete. ${releaseInfo}`;
      }
    }
    if (role === "client") {
      return "Funds held in escrow until milestone is completed.";
    }
    return "Milestone funded. Complete the work to release payment.";
  }

  if (item.type === "service_order") {
    if (item.status === "submitted") {
      if (role === "client") {
        const releaseInfo = item.auto_release_at
          ? `Auto-releases to candidate on ${formatDate(item.auto_release_at)} if no action taken.`
          : `Review and approve the delivery.`;
        return `Delivery submitted. ${releaseInfo}`;
      } else {
        const releaseInfo = item.auto_release_at
          ? `Auto-releases on ${formatDate(item.auto_release_at)} if client takes no action.`
          : `Waiting for client review.`;
        return `Delivery submitted. ${releaseInfo}`;
      }
    }
    if (role === "client") {
      return "Order in progress. Funds held in escrow.";
    }
    return "Order in progress. Complete and submit delivery to release funds.";
  }

  return "Funds held in escrow.";
}

function getTypeLabel(type: string): string {
  switch (type) {
    case "payment_period": return "Payment Period";
    case "milestone": return "Milestone";
    case "service_order": return "Service Order";
    default: return "Payment";
  }
}

function getTypeIcon(type: string): string {
  switch (type) {
    case "payment_period": return "🔄";
    case "milestone": return "🎯";
    case "service_order": return "📦";
    default: return "💰";
  }
}

function getStatusColor(item: EscrowItem): string {
  if (item.status === "candidate_marked_complete" || item.status === "submitted") {
    return "border-amber-200 bg-amber-50";
  }
  return "border-blue-200 bg-blue-50";
}

export default function EscrowStatusPanel({ role }: { role: "client" | "candidate" }) {
  const [data, setData] = useState<EscrowData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchEscrow() {
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const res = await fetch("/api/escrow/status", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });

        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch {
        // silent
      }
      setLoading(false);
    }

    fetchEscrow();
    // Refresh every 60 seconds for near-real-time
    const interval = setInterval(fetchEscrow, 60000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" />
          <span className="text-sm text-gray-500">Loading escrow status...</span>
        </div>
      </div>
    );
  }

  if (!data || data.count === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">🔒</span>
          <h3 className="text-sm font-semibold text-[#1C1B1A]">Escrow Status</h3>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          No active payments in escrow.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-0 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔒</span>
          <h3 className="text-sm font-semibold text-[#1C1B1A]">Escrow Status</h3>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Total in escrow</p>
          <p className="text-lg font-bold text-[#FE6E3E] whitespace-nowrap">
            ${data.total_in_escrow.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {data.escrow.map((item) => (
          <div
            key={`${item.type}-${item.id}`}
            className={`rounded-lg border p-4 ${getStatusColor(item)}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm">{getTypeIcon(item.type)}</span>
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    {getTypeLabel(item.type)}
                  </span>
                  {item.auto_release_at && (
                    <span className="text-xs font-medium text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">
                      {timeUntil(item.auto_release_at)}
                    </span>
                  )}
                </div>

                {/* Title / context */}
                <p className="text-sm font-medium text-[#1C1B1A] truncate">
                  {item.title || (
                    item.period_start && item.period_end
                      ? `${formatShortDate(item.period_start)} — ${formatShortDate(item.period_end)}`
                      : "Payment"
                  )}
                  {role === "client" && item.candidate_name && (
                    <span className="text-gray-500 font-normal"> — {item.candidate_name}</span>
                  )}
                </p>

                {/* Status message — all dates from UTC server timestamps */}
                <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                  {getStatusMessage(item, role)}
                </p>
              </div>

              <div className="text-right shrink-0">
                <p className="text-sm font-bold text-[#1C1B1A] whitespace-nowrap">
                  ${Number(item.amount_usd).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </p>
                {item.funded_at && (
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Funded {formatShortDate(item.funded_at)}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-gray-400 mt-3 text-center">
        All dates shown in your local timezone. Escrow refreshes every 60 seconds.
      </p>
    </div>
  );
}
