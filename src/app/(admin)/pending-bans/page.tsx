"use client";

import { useState, useEffect, useCallback } from "react";
import { isLive } from "@/lib/candidateStatus";

interface PendingBan {
  id: string;
  full_name: string;
  display_name: string | null;
  role_category: string;
  country: string;
  admin_status: string;
  ban_reason: string;
  ban_requested_at: string;
  ban_requested_by_name: string;
}

export default function PendingBansPage() {
  const [candidates, setCandidates] = useState<PendingBan[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/pending-bans");
    if (res.ok) {
      const data = await res.json();
      setCandidates(data.candidates || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAction(candidateId: string, action: "confirm" | "dismiss") {
    setActing(candidateId + action);
    const res = await fetch("/api/admin/pending-bans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId, action }),
    });
    if (res.ok) {
      setCandidates((prev) => prev.filter((c) => c.id !== candidateId));
    }
    setActing(null);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#1C1B1A]">Pending Bans</h1>
      <p className="mt-1 text-sm text-gray-500">
        Ban requests submitted by Manar — awaiting your confirmation.
      </p>

      <div className="mt-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" />
          </div>
        ) : candidates.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
            <p className="text-gray-500">No pending ban requests.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {candidates.map((c) => {
              const name = c.display_name || c.full_name;
              const isConfirming = acting === c.id + "confirm";
              const isDismissing = acting === c.id + "dismiss";
              const isActing = isConfirming || isDismissing;

              return (
                <div key={c.id} className="rounded-xl border border-orange-200 bg-orange-50 p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-[#1C1B1A]">{name}</p>
                        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700 border border-orange-300">
                          Ban Requested
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          isLive(c.admin_status) ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                        }`}>
                          {c.admin_status?.replace(/_/g, " ")}
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm text-gray-500">
                        {c.role_category} · {c.country}
                      </p>
                      <p className="mt-3 text-xs text-gray-500">
                        <strong>Requested by:</strong> {c.ban_requested_by_name} ·{" "}
                        {new Date(c.ban_requested_at).toLocaleDateString("en-US", {
                          month: "short", day: "numeric", year: "numeric",
                          hour: "numeric", minute: "2-digit",
                        })}
                      </p>
                      <div className="mt-2 rounded-lg border border-orange-200 bg-white p-3">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Reason</p>
                        <p className="text-sm text-[#1C1B1A] whitespace-pre-wrap">{c.ban_reason}</p>
                      </div>
                    </div>

                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => handleAction(c.id, "dismiss")}
                        disabled={isActing}
                        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-[#1C1B1A] hover:bg-gray-50 disabled:opacity-50"
                      >
                        {isDismissing ? "Dismissing..." : "Dismiss"}
                      </button>
                      <button
                        onClick={() => handleAction(c.id, "confirm")}
                        disabled={isActing}
                        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {isConfirming ? "Banning..." : "Confirm Ban"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
