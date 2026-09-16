"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/admin/Toast";

/**
 * Take a review down, or put it back.
 *
 * `published` is the only way back from a review that is already public, so
 * the confirm names what the act actually does — which differs by direction.
 * A candidate review is on a public profile and counts toward that candidate's
 * public rating; a client review is private to the client either way.
 */
export default function ReviewTakedownButton({
  reviewId,
  published,
  aboutCandidate,
}: {
  reviewId: string;
  published: boolean;
  aboutCandidate: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (published) {
      const what = aboutCandidate
        ? "This removes the review from the candidate's public profile and from their public rating. Nothing is deleted."
        : "This hides the review from the client. Nothing is deleted.";
      if (!confirm(`${what}\n\nContinue?`)) return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/admin/reviews", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId, published: !published }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(`Not changed — ${err.error || res.status}`);
        setBusy(false);
        return;
      }

      showToast(published ? "Review taken down" : "Review restored");
      router.refresh();
    } catch {
      showToast("Network error — nothing changed");
    }
    setBusy(false);
  }

  return (
    <button
      type="button"
      className={`adm-btn${published ? " danger" : " primary"}`}
      disabled={busy}
      onClick={toggle}
    >
      {busy ? "Saving…" : published ? "Take down" : "Restore"}
    </button>
  );
}
