"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/admin/Toast";

/**
 * The decisions an admin can take on a candidate record.
 *
 * Everything here posts to `/api/admin/candidates/review`, which already
 * carries the guards and the emails. Note the asymmetry it enforces and this
 * bar reflects: a recruiting manager may request revisions but may not
 * approve or reject — every action on that route other than
 * `revision_required` is admin-only. Showing a manager an Approve button that
 * answers 403 would be worse than not showing it.
 */
export default function CandidateActions({
  candidateId,
  adminStatus,
  canDecide,
}: {
  candidateId: string;
  adminStatus: string | null;
  canDecide: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    try {
      const res = await fetch("/api/admin/candidates/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, action, ...extra }),
      });
      if (res.ok) {
        showToast(
          action === "approve" ? "Approved and live"
            : action === "reject" ? "Application closed"
            : "Revision request sent"
        );
        // The record is a server component, so the page has to be re-fetched
        // for the new status to show. router.refresh re-runs the loader
        // without losing scroll position.
        router.refresh();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(`Could not ${action.replace("_", " ")}: ${err.error || res.status}`);
      }
    } catch {
      showToast("Network error");
    }
    setBusy(null);
  }

  function requestRevision() {
    const note = prompt("What does this candidate need to change?");
    if (!note) return;
    act("revision_required", { revisionNote: note });
  }

  function reject() {
    const reason = prompt("Why is this application being closed? The candidate is told.");
    if (!reason) return;
    if (!confirm("Close this application? The candidate is emailed the reason.")) return;
    act("reject", { reason });
  }

  const isLive = adminStatus === "approved";

  return (
    <div className="rec-actionbar">
      <button type="button" className="adm-btn" disabled={busy !== null} onClick={requestRevision}>
        {busy === "revision_required" ? "Sending…" : "Request revision"}
      </button>

      {canDecide && !isLive && (
        <button type="button" className="adm-btn primary" disabled={busy !== null} onClick={() => act("approve")}>
          {busy === "approve" ? "Approving…" : "Approve"}
        </button>
      )}

      {canDecide && (
        <button type="button" className="adm-btn danger" disabled={busy !== null} onClick={reject}>
          {busy === "reject" ? "Closing…" : "Close application"}
        </button>
      )}

      <span className="audit-badge">Logged</span>

      {!canDecide && (
        <span className="rec-action-note">
          Approving and closing are admin-only. You can request revisions.
        </span>
      )}
    </div>
  );
}
