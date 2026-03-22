"use client";

import { useState, useEffect } from "react";

const DECISION_OPTIONS = [
  { value: "full_client_refund", label: "Full Client Refund" },
  { value: "full_candidate_release", label: "Full Candidate Release" },
  { value: "split_50_50", label: "50/50 Split" },
  { value: "pro_rata", label: "Pro-Rata Split" },
  { value: "fraud_ban", label: "Fraud — Permanent Ban" },
];

interface Dispute {
  id: string;
  engagement_id: string;
  period_id: string | null;
  milestone_id: string | null;
  filed_by: string;
  filed_at: string;
  amount_in_escrow_usd: number;
  client_statement: string | null;
  candidate_statement: string | null;
  client_evidence_url: string | null;
  candidate_evidence_url: string | null;
  decision: string | null;
  decision_notes: string | null;
  resolved_at: string | null;
  contract_type: string;
  client_name: string;
  candidate_name: string;
}

export default function DisputeQueuePage() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("open");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    loadDisputes();
  }, [filter]);

  async function loadDisputes() {
    setLoading(true);
    const res = await fetch(`/api/disputes/list?status=${filter}`);
    const data = await res.json();
    setDisputes(data.disputes || []);
    setLoading(false);
  }

  async function handleResolve(disputeId: string) {
    if (!decisions[disputeId]) {
      alert("Please select a decision before resolving.");
      return;
    }

    if (decisions[disputeId] === "fraud_ban") {
      if (!confirm("This will permanently ban the offending party. Continue?")) return;
    }

    setActionLoading(disputeId);

    await fetch("/api/disputes/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        disputeId,
        decision: decisions[disputeId],
        notes: notes[disputeId] || "",
      }),
    });

    setDisputes((prev) => prev.filter((d) => d.id !== disputeId));
    setActionLoading(null);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text">Dispute Queue</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
        >
          <option value="open">Open Disputes</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>

      {loading ? (
        <p className="mt-8 text-text/60">Loading disputes...</p>
      ) : disputes.length === 0 ? (
        <p className="mt-8 text-text/60">
          {filter === "open" ? "No open disputes." : "No resolved disputes."}
        </p>
      ) : (
        <div className="mt-6 space-y-4">
          {disputes.map((d) => {
            const isExpanded = expandedId === d.id;

            return (
              <div
                key={d.id}
                className="rounded-xl border border-gray-200 bg-card overflow-hidden"
              >
                {/* Summary */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : d.id)}
                  className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-gray-50"
                >
                  <div>
                    <p className="font-semibold text-text">
                      {d.client_name} vs {d.candidate_name}
                    </p>
                    <p className="text-xs text-text/60">
                      {d.contract_type} &middot; Filed by {d.filed_by} &middot;{" "}
                      {new Date(d.filed_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-text">
                      ${Number(d.amount_in_escrow_usd).toLocaleString()}
                    </span>
                    {d.resolved_at ? (
                      <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                        {d.decision?.replace(/_/g, " ")}
                      </span>
                    ) : (
                      <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
                        Open
                      </span>
                    )}
                    <svg
                      className={`h-5 w-5 text-text/40 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </div>
                </button>

                {/* Detail */}
                {isExpanded && (
                  <div className="border-t border-gray-200 px-6 py-5 space-y-5">
                    {/* Statements */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                        <p className="text-xs font-semibold text-text/40 uppercase tracking-wider mb-2">
                          Client Statement
                        </p>
                        <p className="text-sm text-text/80">
                          {d.client_statement || "No statement submitted yet."}
                        </p>
                        {d.client_evidence_url && (
                          <a
                            href={d.client_evidence_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 inline-block text-xs text-primary hover:text-primary-dark"
                          >
                            View Evidence
                          </a>
                        )}
                      </div>
                      <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                        <p className="text-xs font-semibold text-text/40 uppercase tracking-wider mb-2">
                          Candidate Statement
                        </p>
                        <p className="text-sm text-text/80">
                          {d.candidate_statement || "No statement submitted yet."}
                        </p>
                        {d.candidate_evidence_url && (
                          <a
                            href={d.candidate_evidence_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 inline-block text-xs text-primary hover:text-primary-dark"
                          >
                            View Evidence
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Resolution (open disputes only) */}
                    {!d.resolved_at && (
                      <div className="border-t border-gray-200 pt-4">
                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-text/60 mb-1">
                              Decision
                            </label>
                            <select
                              value={decisions[d.id] || ""}
                              onChange={(e) =>
                                setDecisions((prev) => ({
                                  ...prev,
                                  [d.id]: e.target.value,
                                }))
                              }
                              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
                            >
                              <option value="">Select decision...</option>
                              {DECISION_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-text/60 mb-1">
                              Internal Notes
                            </label>
                            <textarea
                              value={notes[d.id] || ""}
                              onChange={(e) =>
                                setNotes((prev) => ({
                                  ...prev,
                                  [d.id]: e.target.value,
                                }))
                              }
                              rows={2}
                              placeholder="Document reasoning..."
                              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text focus:border-primary focus:outline-none resize-none"
                            />
                          </div>
                          <button
                            onClick={() => handleResolve(d.id)}
                            disabled={
                              actionLoading === d.id || !decisions[d.id]
                            }
                            className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-50"
                          >
                            {actionLoading === d.id
                              ? "Resolving..."
                              : "Resolve Dispute"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Resolved info */}
                    {d.resolved_at && d.decision_notes && (
                      <div className="border-t border-gray-200 pt-4">
                        <p className="text-xs font-semibold text-text/40 uppercase tracking-wider mb-1">
                          Resolution Notes
                        </p>
                        <p className="text-sm text-text/80">{d.decision_notes}</p>
                        <p className="mt-2 text-xs text-text/40">
                          Resolved {new Date(d.resolved_at).toLocaleString()}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
