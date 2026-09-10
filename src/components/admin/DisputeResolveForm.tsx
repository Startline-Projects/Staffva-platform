"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/admin/Toast";

/**
 * The decision on one open dispute.
 *
 * The previous version fired this POST, ignored the response, and removed the
 * row from the list regardless. The route answers 400 for an already-resolved
 * dispute, 404 for an unknown one and 403 for the wrong role — in every one of
 * those cases the dispute vanished from the admin's screen while remaining
 * open in the database, escrow untouched and nobody aware. Nothing is removed
 * here until the server confirms, and then the page is re-read rather than
 * patched locally.
 */

const DECISIONS = [
  { value: "full_client_refund", label: "Full refund to client" },
  { value: "full_candidate_release", label: "Full release to candidate" },
  { value: "split_50_50", label: "Split 50/50" },
  { value: "pro_rata", label: "Pro-rata split" },
  { value: "fraud_ban", label: "Fraud — permanent ban" },
];

export default function DisputeResolveForm({ disputeId }: { disputeId: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [decision, setDecision] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!decision) { showToast("Choose a decision first"); return; }
    if (decision === "fraud_ban" && !confirm("This permanently bans the offending party. Continue?")) return;

    setBusy(true);
    try {
      const res = await fetch("/api/disputes/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disputeId, decision, notes }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(`Not resolved — ${err.error || res.status}. The dispute is still open.`);
        setBusy(false);
        return;
      }

      showToast("Dispute resolved");
      router.refresh();
    } catch {
      showToast("Network error — the dispute was not resolved");
    }
    setBusy(false);
  }

  return (
    <div className="rec-panel" style={{ marginTop: 12 }}>
      <label className="adm-field-label" htmlFor={`dec-${disputeId}`}>Decision</label>
      <select
        id={`dec-${disputeId}`}
        className="adm-select"
        value={decision}
        onChange={(e) => setDecision(e.target.value)}
      >
        <option value="">— Choose —</option>
        {DECISIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <label className="adm-field-label" htmlFor={`note-${disputeId}`} style={{ marginTop: 12 }}>Notes</label>
      <textarea
        id={`note-${disputeId}`}
        className="adm-input"
        rows={3}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="What decided it. Kept on the record."
      />

      <div className="rec-actionbar" style={{ marginTop: 12 }}>
        <button type="button" className="adm-btn primary" disabled={busy} onClick={submit}>
          {busy ? "Resolving…" : "Resolve and move the money"}
        </button>
        <span className="audit-badge">Logged</span>
      </div>
    </div>
  );
}
