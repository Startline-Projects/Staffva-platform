"use client";

import { useState, useEffect } from "react";

interface PendingVideo {
  id: string;
  display_name: string;
  country: string;
  role_category: string;
  video_intro_url: string;
  video_intro_submitted_at: string;
}

/**
 * The video-intro approval queue, unchanged — it used to BE /admin/video-reviews
 * and is now the second tab there. Still the original Tailwind; see the note in
 * the page for why it moved rather than being rebuilt.
 */
export default function VideoIntroQueue() {
  const [candidates, setCandidates] = useState<PendingVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [modalState, setModalState] = useState<{ type: "revision" | "reject"; candidateId: string } | null>(null);
  const [adminNote, setAdminNote] = useState("");
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  // The age colouring and "3h ago" labels need a clock, and render may not
  // read one. Taken once when the queue mounts; it is refreshed with the list.
  const [now, setNow] = useState(() => Date.now());

  async function loadPending() {
    try {
      const res = await fetch("/api/admin/video-review");
      const data = await res.json();
      setCandidates(data.candidates || []);

      // Get signed URLs for all videos
      for (const c of data.candidates || []) {
        if (c.video_intro_url) {
          try {
            const urlRes = await fetch("/api/storage/signed-url", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ bucket: "video-intros", path: c.video_intro_url }),
            });
            const urlData = await urlRes.json();
            if (urlData.signedUrl) {
              setSignedUrls((prev) => ({ ...prev, [c.id]: urlData.signedUrl }));
            }
          } catch { /* silent */ }
        }
      }
    } catch { /* silent */ }
    setNow(Date.now());
    setLoading(false);
  }

  useEffect(() => {
    // From a timer, not the effect body: loadPending sets state.
    const t = setTimeout(() => { void loadPending(); }, 0);
    return () => clearTimeout(t);
  }, []);

  async function handleAction(candidateId: string, action: string, note?: string) {
    setActionLoading(candidateId);
    try {
      await fetch("/api/admin/video-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, action, adminNote: note }),
      });
      setModalState(null);
      setAdminNote("");
      await loadPending();
    } catch { /* silent */ }
    setActionLoading(null);
  }

  function getRowColor(submittedAt: string) {
    const hours = (now - new Date(submittedAt).getTime()) / (1000 * 60 * 60);
    if (hours > 48) return "bg-red-50 border-red-200";
    if (hours > 24) return "bg-amber-50 border-amber-200";
    return "bg-white border-gray-200";
  }

  function timeSince(date: string) {
    const hours = Math.floor((now - new Date(date).getTime()) / (1000 * 60 * 60));
    if (hours < 1) return "< 1 hour ago";
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h ago`;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-bold text-[#1C1B1A]">Video Introduction Reviews</h1>
      <p className="mt-1 text-sm text-gray-500">{candidates.length} pending review{candidates.length !== 1 ? "s" : ""}</p>

      {candidates.length === 0 ? (
        <div className="mt-12 text-center">
          <svg className="mx-auto h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="mt-3 text-sm text-gray-500">All video introductions have been reviewed.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {candidates.map((c) => (
            <div key={c.id} className={`rounded-xl border p-5 ${getRowColor(c.video_intro_submitted_at)}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#1C1B1A]">{c.display_name}</p>
                  <p className="text-xs text-gray-500">{c.country} &middot; {c.role_category}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    Submitted {timeSince(c.video_intro_submitted_at)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAction(c.id, "approve")}
                    disabled={actionLoading === c.id}
                    className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => { setModalState({ type: "revision", candidateId: c.id }); setAdminNote(""); }}
                    disabled={actionLoading === c.id}
                    className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
                  >
                    Revision
                  </button>
                  <button
                    onClick={() => { setModalState({ type: "reject", candidateId: c.id }); setAdminNote(""); }}
                    disabled={actionLoading === c.id}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>

              {/* Inline video player */}
              {signedUrls[c.id] && (
                <div className="mt-4 rounded-lg overflow-hidden bg-black">
                  <video
                    src={signedUrls[c.id]}
                    controls
                    playsInline
                    className="w-full max-h-[300px]"
                    preload="metadata"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Revision/Reject Modal */}
      {modalState && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-[#1C1B1A]">
              {modalState.type === "revision" ? "Request Revision" : "Reject Video"}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {modalState.type === "revision"
                ? "Provide a specific note about what needs to be changed."
                : "Provide the reason for rejection."}
            </p>
            <textarea
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              placeholder={modalState.type === "revision" ? "e.g., Please look at the camera instead of reading from a script" : "e.g., Video contains inappropriate content"}
              className="mt-4 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-[#1C1B1A] focus:border-[#FE6E3E] focus:outline-none focus:ring-1 focus:ring-[#FE6E3E]"
              rows={3}
            />
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => { setModalState(null); setAdminNote(""); }}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleAction(modalState.candidateId, modalState.type === "revision" ? "revision_required" : "reject", adminNote)}
                disabled={!adminNote.trim() || actionLoading === modalState.candidateId}
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                  modalState.type === "revision" ? "bg-amber-500 hover:bg-amber-600" : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {modalState.type === "revision" ? "Send Revision Request" : "Reject Video"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
