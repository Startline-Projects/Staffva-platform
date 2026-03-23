"use client";

import { useState } from "react";

interface Props {
  candidateId: string;
  candidateName: string;
  currentPhotoUrl: string | null;
  pendingPhotoUrl: string | null;
  onClose: () => void;
  onComplete: () => void;
}

export default function PhotoReviewModal({
  candidateId,
  candidateName,
  currentPhotoUrl,
  pendingPhotoUrl,
  onClose,
  onComplete,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [rejectionNote, setRejectionNote] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);

  async function handleAction(action: "approve" | "reject") {
    if (action === "reject" && !rejectionNote.trim()) {
      return;
    }

    setLoading(true);

    await fetch("/api/admin/photo-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateId,
        action,
        rejectionNote: rejectionNote.trim() || null,
      }),
    });

    setLoading(false);
    onComplete();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-text">Photo Review — {candidateName}</h3>
          <button onClick={onClose} className="text-text/40 hover:text-text">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Current photo */}
          <div className="text-center">
            <p className="text-xs font-semibold text-text/40 uppercase tracking-wider mb-3">Current Live Photo</p>
            <div className="mx-auto h-40 w-40 overflow-hidden rounded-full border-2 border-gray-200 bg-gray-100">
              {currentPhotoUrl ? (
                <img src={currentPhotoUrl} alt="Current" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-text/20 text-sm">No photo</div>
              )}
            </div>
          </div>

          {/* Pending photo */}
          <div className="text-center">
            <p className="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-3">Pending New Photo</p>
            <div className="mx-auto h-40 w-40 overflow-hidden rounded-full border-2 border-amber-300 bg-amber-50">
              {pendingPhotoUrl ? (
                <img src={pendingPhotoUrl} alt="Pending" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-text/20 text-sm">No photo</div>
              )}
            </div>
          </div>
        </div>

        {!showRejectForm ? (
          <div className="mt-6 flex gap-3">
            <button
              onClick={() => handleAction("approve")}
              disabled={loading}
              className="flex-1 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              {loading ? "..." : "Approve Photo"}
            </button>
            <button
              onClick={() => setShowRejectForm(true)}
              className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
            >
              Reject Photo
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            <textarea
              value={rejectionNote}
              onChange={(e) => setRejectionNote(e.target.value)}
              placeholder="Explain why the photo was not approved..."
              rows={3}
              className="w-full rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-text placeholder-text/40 focus:border-red-500 focus:outline-none resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowRejectForm(false)}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm text-text hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleAction("reject")}
                disabled={loading || !rejectionNote.trim()}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {loading ? "Sending..." : "Reject & Notify"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
