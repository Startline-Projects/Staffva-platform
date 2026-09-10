"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/admin/Toast";

/**
 * Rule on a ban request.
 *
 * The previous version removed the row on success and did nothing at all on
 * failure — no message, no state change, the button simply stopped spinning
 * while the request stayed in the queue. Both outcomes are reported now, and
 * the page is re-read rather than patched locally.
 */
export default function BanDecisionButtons({
  candidateId,
  name,
}: {
  candidateId: string;
  name: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState<"confirm" | "dismiss" | null>(null);

  async function act(action: "confirm" | "dismiss") {
    if (action === "confirm" && !confirm(`Ban ${name}? They lose access to the platform.`)) return;

    setBusy(action);
    try {
      const res = await fetch("/api/admin/pending-bans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, action }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(`Not ${action === "confirm" ? "banned" : "dismissed"} — ${err.error || res.status}. The request is still open.`);
        setBusy(null);
        return;
      }

      showToast(action === "confirm" ? `${name} banned` : "Ban request dismissed");
      router.refresh();
    } catch {
      showToast("Network error — nothing changed");
    }
    setBusy(null);
  }

  return (
    <div className="rec-actionbar">
      <button type="button" className="adm-btn" disabled={busy !== null} onClick={() => act("dismiss")}>
        {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
      </button>
      <button type="button" className="adm-btn danger" disabled={busy !== null} onClick={() => act("confirm")}>
        {busy === "confirm" ? "Banning…" : "Confirm ban"}
      </button>
      <span className="audit-badge">Logged</span>
    </div>
  );
}
