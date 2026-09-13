"use client";

import { useState, useEffect } from "react";
import { isLive } from "@/lib/candidateStatus";
import Link from "next/link";

interface CandidateInfo {
  id: string;
  display_name: string;
  full_name: string;
  email: string;
  country: string;
  role_category: string;
  admin_status: string;
  profile_photo_url: string | null;
}

interface DuplicateRecord {
  id: string;
  identity_hash: string;
  stripe_verification_session_id: string;
  candidate_id: string;
  is_duplicate: boolean;
  duplicate_of_candidate_id: string | null;
  flagged_for_review: boolean;
  review_reason: string | null;
  created_at: string;
  candidate: CandidateInfo | null;
  original_candidate: CandidateInfo | null;
  lockout_expires: string | null;
}

export default function AdminDuplicatesPage() {
  const [records, setRecords] = useState<DuplicateRecord[]>([]);
  const [stats, setStats] = useState({ duplicates: 0, flagged: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "duplicates" | "flagged">("all");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/admin/duplicates");
        if (res.ok) {
          const data = await res.json();
          setRecords(data.records || []);
          setStats(data.stats || { duplicates: 0, flagged: 0 });
        }
      } catch { /* silent */ }
      setLoading(false);
    }
    load();
  }, []);

  const filtered = records.filter((r) => {
    if (filter === "duplicates") return r.is_duplicate;
    if (filter === "flagged") return r.flagged_for_review;
    return true;
  });

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FE6E3E] border-t-transparent" /></div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#1C1B1A]">Duplicate Detection</h1>
      <p className="mt-1 text-sm text-gray-500">Identity duplicates and flagged records for review</p>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-[#1C1B1A]">{stats.duplicates + stats.flagged}</p>
          <p className="text-xs text-gray-500 mt-1">Total Records</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
          <p className="text-2xl font-bold text-red-700">{stats.duplicates}</p>
          <p className="text-xs text-red-600 mt-1">Confirmed Duplicates</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
          <p className="text-2xl font-bold text-amber-700">{stats.flagged}</p>
          <p className="text-xs text-amber-600 mt-1">Flagged for Review</p>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-6 flex gap-2">
        {(["all", "duplicates", "flagged"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
              filter === f ? "bg-[#FE6E3E] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {f === "all" ? "All" : f === "duplicates" ? "Duplicates" : "Flagged"}
          </button>
        ))}
      </div>

      {/* Records */}
      {filtered.length === 0 ? (
        <div className="mt-8 rounded-lg border border-gray-200 bg-white p-12 text-center">
          <p className="text-gray-500">No duplicate or flagged records found.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {filtered.map((r) => (
            <div
              key={r.id}
              className={`rounded-lg border p-4 ${
                r.flagged_for_review ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  {r.is_duplicate && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">Duplicate</span>
                  )}
                  {r.flagged_for_review && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                      {r.review_reason?.replace(/_/g, " ") || "Flagged"}
                    </span>
                  )}
                  <span className="text-[10px] text-gray-400">
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                </div>
                {r.lockout_expires && (
                  <span className="text-[10px] text-red-600 font-medium">
                    Lockout until {new Date(r.lockout_expires).toLocaleDateString()}
                  </span>
                )}
              </div>

              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Duplicate candidate */}
                {r.candidate && (
                  <div className="rounded-lg border border-gray-200 bg-white p-3">
                    <p className="text-[10px] text-gray-400 uppercase font-medium mb-2">
                      {r.is_duplicate ? "Duplicate Account" : "Flagged Account"}
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-gray-100">
                        {r.candidate.profile_photo_url ? (
                          <img src={r.candidate.profile_photo_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-gray-400">
                            {r.candidate.display_name?.[0] || "?"}
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-[#1C1B1A]">{r.candidate.display_name || r.candidate.full_name}</p>
                        <p className="text-[10px] text-gray-500">{r.candidate.email}</p>
                        <p className="text-[10px] text-gray-400">{r.candidate.country} · {r.candidate.role_category}</p>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${
                        r.candidate.admin_status === "duplicate_blocked" ? "bg-red-100 text-red-700" :
                        isLive(r.candidate.admin_status) ? "bg-green-100 text-green-700" :
                        "bg-gray-100 text-gray-600"
                      }`}>
                        {r.candidate.admin_status?.replace(/_/g, " ")}
                      </span>
                      <Link href={`/candidate/${r.candidate.id}`} className="text-[10px] text-[#FE6E3E] hover:underline">View</Link>
                    </div>
                  </div>
                )}

                {/* Original candidate */}
                {r.original_candidate && (
                  <div className="rounded-lg border border-gray-200 bg-white p-3">
                    <p className="text-[10px] text-gray-400 uppercase font-medium mb-2">Original Account</p>
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-gray-100">
                        {r.original_candidate.profile_photo_url ? (
                          <img src={r.original_candidate.profile_photo_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-gray-400">
                            {r.original_candidate.display_name?.[0] || "?"}
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-[#1C1B1A]">{r.original_candidate.display_name || r.original_candidate.full_name}</p>
                        <p className="text-[10px] text-gray-500">{r.original_candidate.email}</p>
                        <p className="text-[10px] text-gray-400">{r.original_candidate.country} · {r.original_candidate.role_category}</p>
                      </div>
                    </div>
                    <div className="mt-2">
                      <Link href={`/candidate/${r.original_candidate.id}`} className="text-[10px] text-[#FE6E3E] hover:underline">View</Link>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-2 text-[9px] text-gray-400 font-mono truncate">
                Hash: {r.identity_hash.slice(0, 16)}... | Session: {r.stripe_verification_session_id.slice(0, 20)}...
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
