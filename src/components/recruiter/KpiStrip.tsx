"use client";

import { useState, useRef, useEffect } from "react";

interface SocialPost {
  id: string;
  post_url: string;
  created_at: string;
}

interface KpiData {
  recruiterType: string;
  socialPosts: SocialPost[];
}

interface KpiStripProps {
  kpi: KpiData;
  token: string;
  onPostLogged: () => void;
}

interface PhotoState {
  recruiter_photo_url: string | null;
  recruiter_photo_pending_url: string | null;
  recruiter_photo_status: string | null;
}

export default function KpiStrip({ kpi, token, onPostLogged }: KpiStripProps) {


  const [postModal, setPostModal] = useState(false);
  const [postUrl, setPostUrl] = useState("");
  const [postSaving, setPostSaving] = useState(false);

  // Photo state
  const [photoOpen, setPhotoOpen] = useState(false);
  const [photoState, setPhotoState] = useState<PhotoState | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadPhotoState() {
    if (!token) return;
    setPhotoLoading(true);
    try {
      const res = await fetch("/api/recruiter/photo", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setPhotoState(await res.json());
    } catch { /* silent */ }
    setPhotoLoading(false);
  }

  useEffect(() => {
    if (photoOpen) loadPhotoState();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoOpen]);

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/recruiter/photo", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) { setUploadError(data.error || "Upload failed."); }
      else { setPhotoState((prev) => ({ ...prev!, ...data })); }
    } catch { setUploadError("Network error. Please try again."); }
    setUploading(false);
    // Reset file input so the same file can be re-selected after a rejection
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Social posts
  const postCount = kpi.socialPosts.length;

  async function handleSavePost() {
    if (!postUrl.trim()) return;
    setPostSaving(true);
    try {
      const res = await fetch("/api/recruiter/social-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ postUrl: postUrl.trim() }),
      });
      if (res.ok) {
        setPostUrl("");
        setPostModal(false);
        onPostLogged();
      }
    } catch { /* silent */ }
    setPostSaving(false);
  }


  return (
    <div className="sticky top-0 z-30 bg-white border-b border-gray-200 px-4 py-3">
      <div className="mx-auto max-w-7xl flex items-center gap-6 flex-wrap">
        {/* Social Posts Pills */}
        <div className="flex items-center gap-2">
          {[0, 1].map((idx) => {
            const posted = idx < postCount;
            return (
              <button
                key={idx}
                onClick={() => !posted && postCount < 2 && setPostModal(true)}
                disabled={posted || postCount >= 2}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                  posted
                    ? "bg-[#FE6E3E] text-white cursor-default"
                    : "border border-[#FE6E3E] text-[#FE6E3E] hover:bg-orange-50"
                }`}
              >
                {posted ? (
                  <span className="flex items-center gap-1">
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                    Post {idx + 1}
                  </span>
                ) : (
                  `Post ${idx + 1}`
                )}
              </button>
            );
          })}
        </div>

        {/* Profile Photo */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPhotoOpen(!photoOpen)}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-[#1C1B1A]"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
            Photo
          </button>
        </div>
      </div>

      {/* Profile Photo panel */}
      {photoOpen && (
        <div className="mx-auto max-w-7xl mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Profile Photo</p>
          {photoLoading ? (
            <div className="h-10 animate-pulse rounded-lg bg-gray-200 w-48" />
          ) : (
            <div className="flex flex-wrap items-start gap-6">
              {/* Current live photo */}
              <div className="flex flex-col items-center gap-2">
                <div className="h-20 w-20 overflow-hidden rounded-full bg-gray-200 border-2 border-gray-300">
                  {photoState?.recruiter_photo_url ? (
                    <img src={photoState.recruiter_photo_url} alt="Current photo" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                      </svg>
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-center text-gray-500 max-w-[90px] leading-tight">
                  {photoState?.recruiter_photo_url ? "Current photo — live on your recruiter card" : "No photo set"}
                </p>
              </div>

              {/* Pending photo */}
              {photoState?.recruiter_photo_pending_url && (
                <div className="flex flex-col items-center gap-2">
                  <div className="h-20 w-20 overflow-hidden rounded-full bg-gray-200 border-2 border-amber-400">
                    <img src={photoState.recruiter_photo_pending_url} alt="Pending photo" className="h-full w-full object-cover" />
                  </div>
                  <p className="text-[10px] text-center text-amber-700 max-w-[110px] leading-tight">
                    Pending approval — your current photo remains live until this is approved
                  </p>
                </div>
              )}

              {/* Upload controls */}
              <div className="flex flex-col gap-2 justify-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handlePhotoUpload}
                  disabled={uploading || photoState?.recruiter_photo_status === "pending_review"}
                />
                {photoState?.recruiter_photo_status === "pending_review" ? (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 max-w-[240px]">
                    Photo pending approval. You will be notified when it is reviewed.
                  </p>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="rounded-lg border border-[#FE6E3E] px-4 py-2 text-sm font-semibold text-[#FE6E3E] hover:bg-orange-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {uploading ? "Uploading…" : "Upload New Photo"}
                  </button>
                )}
                <p className="text-[10px] text-gray-400">JPG, PNG or WEBP · Max 5 MB</p>
                {uploadError && (
                  <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 max-w-[240px]">{uploadError}</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Social post modal */}
      {postModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setPostModal(false)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-[#1C1B1A]">Log Social Post</h3>
            <p className="mt-1 text-sm text-gray-500">Paste the URL of your published social post.</p>
            <input
              type="url"
              value={postUrl}
              onChange={(e) => setPostUrl(e.target.value)}
              placeholder="https://..."
              className="mt-3 w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm focus:border-[#FE6E3E] focus:outline-none focus:ring-1 focus:ring-[#FE6E3E]"
              autoFocus
            />
            <div className="mt-4 flex gap-3">
              <button onClick={() => setPostModal(false)} className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-[#1C1B1A] hover:bg-gray-50">Cancel</button>
              <button
                onClick={handleSavePost}
                disabled={postSaving || !postUrl.trim()}
                className="flex-1 rounded-lg bg-[#FE6E3E] py-2.5 text-sm font-semibold text-white hover:bg-[#E55A2B] disabled:opacity-50"
              >
                {postSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
