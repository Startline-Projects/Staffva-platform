"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface CandidateRef { id: string; display_name: string; full_name: string; country: string; role_category: string; email?: string; admin_status?: string }
interface Lockout { id: string; identity_hash: string; candidate_id: string; failed_at: string; lockout_expires_at: string; attempt_number: number; days_remaining: number; candidate: CandidateRef | null }
interface Duplicate { id: string; identity_hash: string; candidate_id: string; duplicate_of_candidate_id: string; created_at: string; candidate: CandidateRef | null; original: CandidateRef | null }
interface Flagged { id: string; identity_hash: string; candidate_id: string; review_reason: string; created_at: string; flagged_for_review: boolean; candidate: CandidateRef | null }
interface Summary { activeLockouts: number; duplicatesThisWeek: number; flaggedForReview: number; totalVerifications: number }

export default function IdentityManagementPage() {
  const [tab, setTab] = useState<"lockouts" | "duplicates" | "flagged">("lockouts");
  const [lockouts, setLockouts] = useState<Lockout[]>([]);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [flagged, setFlagged] = useState<Flagged[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [overrideModal, setOverrideModal] = useState<{ lockoutId: string; candidateId: string; identityHash: string } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [acting, setActing] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/identity");
      if (res.ok) {
        const data = await res.json();
        setLockouts(data.lockouts || []);
        setDuplicates(data.duplicates || []);
        setFlagged(data.flagged || []);
        setSummary(data.summary || null);
      }
    } catch { /* silent */ }
    setLoading(false);
  }

  async function doAction(action: string, params: Record<string, string>) {
    setActing(true);
    await fetch("/api/admin/identity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...params }) });
    setOverrideModal(null);
    setOverrideReason("");
    setActing(false);
    await loadData();
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-text">Identity Management</h1>
      <p className="mt-1 text-sm text-text-muted">Lockouts, duplicates, and flagged identities</p>

      {/* Summary */}
      {summary && (
        <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-border-light bg-card p-4 text-center">
            <p className="text-2xl font-semibold text-text">{summary.activeLockouts}</p>
            <p className="text-xs text-text-tertiary mt-1">Active Lockouts</p>
          </div>
          <div className="rounded-2xl border border-border-light bg-card p-4 text-center">
            <p className="text-2xl font-semibold text-text">{summary.duplicatesThisWeek}</p>
            <p className="text-xs text-text-tertiary mt-1">Duplicates This Week</p>
          </div>
          <div className="rounded-2xl border border-border-light bg-card p-4 text-center">
            <p className="text-2xl font-semibold text-primary">{summary.flaggedForReview}</p>
            <p className="text-xs text-text-tertiary mt-1">Flagged for Review</p>
          </div>
          <div className="rounded-2xl border border-border-light bg-card p-4 text-center">
            <p className="text-2xl font-semibold text-text">{summary.totalVerifications}</p>
            <p className="text-xs text-text-tertiary mt-1">Total Verifications</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="mt-8 flex gap-1 border-b border-border-light">
        {(["lockouts", "duplicates", "flagged"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${tab === t ? "border-primary text-primary" : "border-transparent text-text-muted hover:text-text"}`}>
            {t === "lockouts" ? `Active Lockouts (${lockouts.length})` : t === "duplicates" ? `Duplicates (${duplicates.length})` : `Flagged (${flagged.length})`}
          </button>
        ))}
      </div>

      {/* ═══ LOCKOUTS ═══ */}
      {tab === "lockouts" && (
        <div className="mt-6 space-y-3">
          {lockouts.length === 0 ? <p className="py-12 text-center text-text-tertiary">No active lockouts</p> : lockouts.map((l) => (
            <div key={l.id} className="rounded-2xl border border-red-200 bg-red-50 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <Link href={`/candidate/${l.candidate_id}`} className="text-sm font-semibold text-text hover:text-primary">{l.candidate?.display_name || l.candidate?.full_name || "Unknown"}</Link>
                  <p className="text-xs text-text-tertiary">{l.candidate?.country} · {l.candidate?.role_category}</p>
                </div>
                <div className="text-right">
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">Attempt {l.attempt_number}/5</span>
                  <p className="text-xs text-red-600 font-medium mt-1">{l.days_remaining}d remaining</p>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-4 text-xs text-text-tertiary">
                <span>Failed: {new Date(l.failed_at).toLocaleDateString()}</span>
                <span>Expires: {new Date(l.lockout_expires_at).toLocaleDateString()}</span>
              </div>
              <button onClick={() => setOverrideModal({ lockoutId: l.id, candidateId: l.candidate_id, identityHash: l.identity_hash })} className="mt-3 text-xs font-medium text-primary hover:underline">Override lockout</button>
            </div>
          ))}
        </div>
      )}

      {/* ═══ DUPLICATES ═══ */}
      {tab === "duplicates" && (
        <div className="mt-6 space-y-3">
          {duplicates.length === 0 ? <p className="py-12 text-center text-text-tertiary">No duplicate accounts detected</p> : duplicates.map((d) => (
            <div key={d.id} className="rounded-2xl border border-border-light bg-card p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] text-text-tertiary uppercase tracking-wide mb-1">Duplicate</p>
                  {d.candidate ? (
                    <Link href={`/candidate/${d.candidate.id}`} className="text-sm font-semibold text-text hover:text-primary">{d.candidate.display_name || d.candidate.full_name}</Link>
                  ) : <span className="text-sm text-text-tertiary">Unknown</span>}
                  <p className="text-xs text-text-tertiary">{d.candidate?.country} · {d.candidate?.admin_status?.replace(/_/g, " ")}</p>
                </div>
                <div>
                  <p className="text-[10px] text-text-tertiary uppercase tracking-wide mb-1">Original</p>
                  {d.original ? (
                    <Link href={`/candidate/${d.original.id}`} className="text-sm font-semibold text-text hover:text-primary">{d.original.display_name || d.original.full_name}</Link>
                  ) : <span className="text-sm text-text-tertiary">Unknown</span>}
                  <p className="text-xs text-text-tertiary">{d.original?.country}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-text-tertiary">Detected: {new Date(d.created_at).toLocaleDateString()}</span>
                {d.candidate?.admin_status !== "duplicate_blocked" && (
                  <button onClick={() => doAction("merge_duplicate", { duplicateId: d.id, originalCandidateId: d.duplicate_of_candidate_id, duplicateCandidateId: d.candidate_id })} disabled={acting} className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50">Merge & close duplicate</button>
                )}
                {d.candidate?.admin_status === "duplicate_blocked" && (
                  <span className="text-xs text-text-tertiary">Closed</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ FLAGGED ═══ */}
      {tab === "flagged" && (
        <div className="mt-6 space-y-3">
          {flagged.length === 0 ? <p className="py-12 text-center text-text-tertiary">No flagged identities</p> : flagged.map((f) => (
            <div key={f.id} className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start justify-between">
                <div>
                  {f.candidate ? (
                    <Link href={`/candidate/${f.candidate.id}`} className="text-sm font-semibold text-text hover:text-primary">{f.candidate.display_name || f.candidate.full_name}</Link>
                  ) : <span className="text-sm text-text-tertiary">Unknown</span>}
                  <p className="text-xs text-text-tertiary">{f.candidate?.country} · {f.candidate?.role_category}</p>
                  <p className="mt-1 text-xs text-amber-700">{f.review_reason?.replace(/_/g, " ")}</p>
                </div>
                <span className="text-xs text-text-tertiary">{new Date(f.created_at).toLocaleDateString()}</span>
              </div>
              <div className="mt-3 flex gap-2">
                <button onClick={() => doAction("review_flagged", { identityId: f.id, decision: "confirm_duplicate" })} disabled={acting} className="rounded-full bg-red-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-red-700 disabled:opacity-50">Confirm Duplicate</button>
                <button onClick={() => doAction("review_flagged", { identityId: f.id, decision: "confirm_legitimate" })} disabled={acting} className="rounded-full border border-border px-3 py-1 text-[11px] font-medium text-text hover:border-text disabled:opacity-50">Confirm Legitimate</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Override modal */}
      {overrideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setOverrideModal(null)}>
          <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-text">Override Lockout</h2>
            <p className="mt-1 text-sm text-text-muted">This action is logged and cannot be undone.</p>
            <textarea value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Reason for override (required)" rows={3} className="mt-4 w-full rounded-xl border border-border-light bg-background px-4 py-3 text-sm text-text placeholder-text-tertiary focus:border-primary focus:outline-none resize-none" />
            <div className="mt-4 flex gap-3">
              <button onClick={() => setOverrideModal(null)} className="flex-1 rounded-full border border-border py-2.5 text-sm font-medium text-text hover:border-text transition-colors">Cancel</button>
              <button onClick={() => doAction("override_lockout", { ...overrideModal, reason: overrideReason })} disabled={!overrideReason.trim() || acting} className="flex-1 rounded-full bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50 transition-colors">{acting ? "..." : "Override"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
