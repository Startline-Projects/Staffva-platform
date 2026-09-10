"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/admin/Toast";

/**
 * The one setting this platform actually stores.
 *
 * `saved` used to be set on `res.ok` alone, and the route answered 200 even
 * when its UPDATE had failed — so the page reported success for a write that
 * never happened. The route now returns the stored value, and this only says
 * saved when that value comes back matching what was sent.
 */
export default function SettingsForm({
  initial,
  stored,
}: {
  initial: number;
  /** False when the value shown is the code default, not a saved one. */
  stored: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cheat_flag_threshold: value }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        showToast(`Not saved — ${body.error || res.status}`);
        setBusy(false);
        return;
      }

      if (body?.settings?.cheat_flag_threshold !== value) {
        showToast("The server accepted the request but stored something else. Nothing changed.");
        setBusy(false);
        return;
      }

      showToast(`Threshold saved as ${value}`);
      router.refresh();
    } catch {
      showToast("Network error — nothing was saved");
    }
    setBusy(false);
  }

  return (
    <div className="rec-panel">
      <div className="rec-panel-label">Anti-cheat flag threshold</div>
      <p className="rec-prose" style={{ marginBottom: 12 }}>
        How many test-window exits a candidate can accumulate before the review queue highlights
        them. This is a display threshold — it changes what the queue draws attention to, not what
        the platform enforces.
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ maxWidth: 140 }}>
          <label className="adm-field-label" htmlFor="threshold">Flags</label>
          <input
            id="threshold"
            type="number"
            min={1}
            max={100}
            className="adm-input"
            value={value}
            onChange={(e) => setValue(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
          />
        </div>
        <button type="button" className="adm-btn primary" disabled={busy || value === initial} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>

      {!stored && (
        <p className="rec-note-line" style={{ marginTop: 10 }}>
          Showing the code default. Nothing has ever been saved to this setting.
        </p>
      )}
    </div>
  );
}
