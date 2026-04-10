"use client";

import { useState, useEffect } from "react";

interface Recruiter {
  id: string;
  full_name: string;
  email: string;
  calendar_link: string | null;
}

interface ReassignModalProps {
  candidateId: string;
  candidateName: string;
  currentRecruiterId: string | null;
  currentRecruiterName: string | null;
  token: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ReassignModal({
  candidateId,
  candidateName,
  currentRecruiterId,
  currentRecruiterName,
  token,
  onClose,
  onSuccess,
}: ReassignModalProps) {
  const [recruiters, setRecruiters] = useState<Recruiter[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/reassign/recruiters", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setRecruiters(data.recruiters || []);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load recruiters.");
        setLoading(false);
      });
  }, [token]);

  async function handleConfirm() {
    if (!selectedId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/reassign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ candidateId, newRecruiterId: selectedId, reason: reason.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Reassignment failed."); setSubmitting(false); return; }
      onSuccess();
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  // Close on backdrop click
  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  const selected = recruiters.find((r) => r.id === selectedId) || null;
  const isSame = selectedId && selectedId === currentRecruiterId;
  const resolvedCurrentName = recruiters.find((r) => r.id === currentRecruiterId)?.full_name || currentRecruiterName;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={handleBackdrop}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-semibold text-[#1C1B1A]">Reassign Candidate</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Candidate info */}
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-1">Candidate</p>
            <p className="text-sm font-semibold text-[#1C1B1A]">{candidateName}</p>
          </div>

          {/* Current recruiter */}
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-1">Currently Assigned To</p>
            <p className="text-sm text-gray-600">{resolvedCurrentName || <span className="italic text-gray-400">Unassigned</span>}</p>
          </div>

          {/* New recruiter select */}
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-gray-400 mb-1">
              Assign To
            </label>
            {loading ? (
              <div className="h-10 rounded-lg bg-gray-100 animate-pulse" />
            ) : (
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#FE6E3E] focus:outline-none focus:ring-1 focus:ring-[#FE6E3E]"
              >
                <option value="">— Select a recruiter —</option>
                {recruiters.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.full_name}{r.id === currentRecruiterId ? " (current)" : ""}
                  </option>
                ))}
              </select>
            )}
            {isSame && (
              <p className="mt-1 text-xs text-amber-600">This is already the assigned recruiter.</p>
            )}
          </div>

          {/* Reason */}
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-gray-400 mb-1">
              Reason <span className="normal-case font-normal text-gray-400">(optional)</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. Schedule conflict, territory change..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#FE6E3E] focus:outline-none focus:ring-1 focus:ring-[#FE6E3E] resize-none"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-6 py-4">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedId || !!isSame || submitting || loading}
            className="rounded-lg bg-[#FE6E3E] px-5 py-2 text-sm font-semibold text-white hover:bg-[#E55A2B] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Reassigning…" : "Confirm Reassignment"}
          </button>
        </div>
      </div>
    </div>
  );
}
