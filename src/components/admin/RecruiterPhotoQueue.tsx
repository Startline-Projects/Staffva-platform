"use client";

import { useState, useEffect, useCallback } from "react";

interface PendingPhoto {
  id: string;
  full_name: string | null;
  role: string;
  recruiter_photo_url: string | null;
  recruiter_photo_pending_url: string | null;
  recruiter_photo_pending_uploaded_at: string | null;
}

interface RejectModalState {
  profileId: string;
  recruiterName: string;
  reason: string;
  submitting: boolean;
  error: string | null;
}

function Avatar({ src, label }: { src: string | null; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <div className="h-24 w-24 overflow-hidden rounded-full border-2 border-gray-200 bg-gray-100">
        {src ? (
          <img src={src} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <svg className="h-10 w-10 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}

export default function RecruiterPhotoQueue({
  token,
  currentUserId,
  currentUserRole,
}: {
  token: string;
  currentUserId: string;
  currentUserRole: string;
}) {
  const [queue, setQueue] = useState<PendingPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<RejectModalState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/recruiter-photo", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setQueue(data.queue || []);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function handleApprove(profileId: string) {
    setActing(profileId);
    try {
      const res = await fetch("/api/admin/recruiter-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "approve", profileId }),
      });
      if (res.ok) await load();
    } catch { /* silent */ }
    setActing(null);
  }

  async function handleRejectSubmit() {
    if (!rejectModal) return;
    if (!rejectModal.reason.trim()) {
      setRejectModal((p) => p && ({ ...p, error: "Rejection reason is required." }));
      return;
    }
    setRejectModal((p) => p && ({ ...p, submitting: true, error: null }));
    try {
      const res = await fetch("/api/admin/recruiter-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "reject", profileId: rejectModal.profileId, reason: rejectModal.reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRejectModal((p) => p && ({ ...p, submitting: false, error: data.error || "Rejection failed." }));
        return;
      }
      setRejectModal(null);
      await load();
    } catch {
      setRejectModal((p) => p && ({ ...p, submitting: false, error: "Network error. Please try again." }));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" />
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-2">
        <svg className="h-10 w-10 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-sm text-gray-400">No photos pending approval.</p>
      </div>
    );
  }

  const ROLE_LABELS: Record<string, string> = {
    recruiter: "Recruiter",
    recruiting_manager: "Recruiting Manager",
    admin: "Admin",
  };

  return (
    <>
      <div className="space-y-4">
        {queue.map((item) => (
          <div key={item.id} className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex flex-wrap items-start gap-6">
              {/* Recruiter info */}
              <div className="min-w-[160px]">
                <p className="text-sm font-semibold text-[#1C1B1A]">{item.full_name || "—"}</p>
                <p className="text-xs text-gray-400">{ROLE_LABELS[item.role] || item.role}</p>
                {item.recruiter_photo_pending_uploaded_at && (
                  <p className="mt-1 text-[10px] text-gray-400">
                    Uploaded{" "}
                    {new Date(item.recruiter_photo_pending_uploaded_at).toLocaleDateString("en-US", {
                      month: "short", day: "numeric", year: "numeric",
                      hour: "numeric", minute: "2-digit",
                    })}
                  </p>
                )}
              </div>

              {/* Side-by-side photo comparison */}
              <div className="flex items-start gap-8">
                <Avatar src={item.recruiter_photo_url} label="Current live photo" />
                <Avatar src={item.recruiter_photo_pending_url} label="Pending photo" />
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-3 ml-auto self-center">
                {currentUserRole === "recruiting_manager" && item.id === currentUserId ? (
                  <p className="text-xs text-gray-400 italic max-w-[180px] text-right">
                    Your photo must be approved by Admin.
                  </p>
                ) : (
                  <>
                    <button
                      onClick={() => handleApprove(item.id)}
                      disabled={acting === item.id}
                      className="rounded-lg bg-[#FE6E3E] px-5 py-2 text-sm font-semibold text-white hover:bg-[#E55A2B] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {acting === item.id ? "Approving…" : "Approve"}
                    </button>
                    <button
                      onClick={() =>
                        setRejectModal({
                          profileId: item.id,
                          recruiterName: item.full_name || "this recruiter",
                          reason: "",
                          submitting: false,
                          error: null,
                        })
                      }
                      disabled={acting === item.id}
                      className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Reject
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Reject modal */}
      {rejectModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={(e) => { if (e.target === e.currentTarget && !rejectModal.submitting) setRejectModal(null); }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h2 className="text-base font-semibold text-[#1C1B1A]">Reject Photo</h2>
              <button
                onClick={() => !rejectModal.submitting && setRejectModal(null)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 transition-colors"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-gray-500">
                Provide a reason for rejecting <strong>{rejectModal.recruiterName}</strong>&apos;s photo. They will be notified and their upload button will re-enable immediately.
              </p>
              <div>
                <textarea
                  value={rejectModal.reason}
                  onChange={(e) =>
                    setRejectModal((p) =>
                      p && ({ ...p, reason: e.target.value.slice(0, 200), error: null })
                    )
                  }
                  rows={3}
                  placeholder="e.g. Photo is blurry, not a professional headshot, background is distracting..."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#FE6E3E] focus:outline-none focus:ring-1 focus:ring-[#FE6E3E] resize-none"
                  disabled={rejectModal.submitting}
                />
                <p className="mt-1 text-right text-[10px] text-gray-400">
                  {rejectModal.reason.length}/200
                </p>
              </div>
              {rejectModal.error && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{rejectModal.error}</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-6 py-4">
              <button
                onClick={() => setRejectModal(null)}
                disabled={rejectModal.submitting}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRejectSubmit}
                disabled={rejectModal.submitting || !rejectModal.reason.trim()}
                className="rounded-lg border border-gray-300 bg-white px-5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {rejectModal.submitting ? "Rejecting…" : "Confirm Rejection"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
