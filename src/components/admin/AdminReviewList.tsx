"use client";

import { useEffect, useState } from "react";

interface AdminReview {
  id: string;
  engagement_id: string;
  direction: "client_to_candidate" | "candidate_to_client";
  rating: number;
  body: string | null;
  submitted_at: string;
  reveal_at: string;
  published: boolean;
  candidate_id: string;
  client_id: string;
}

const DIRECTION_LABEL: Record<AdminReview["direction"], string> = {
  client_to_candidate: "Client → Candidate",
  candidate_to_client: "Candidate → Client",
};

export default function AdminReviewList() {
  const [reviews, setReviews] = useState<AdminReview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/admin/reviews");
      const j = await res.json();
      if (!res.ok) {
        setError(j.error || "Could not load reviews.");
        return;
      }
      setReviews(j.reviews);
      setError(null);
    } catch {
      setError("Could not reach the server.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function setPublished(id: string, published: boolean) {
    setBusy(id);
    try {
      const res = await fetch("/api/admin/reviews", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId: id, published }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error || "Could not update that review.");
        return;
      }
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p style={{ fontSize: 13, color: "#B42318" }}>{error}</p>;
  if (reviews === null) return <p style={{ fontSize: 13, color: "#6B6862" }}>Loading…</p>;

  // The honest empty state. No review has ever been submitted on this platform:
  // eligibility is released money, and no engagement has released any.
  if (reviews.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "#6B6862" }}>
        No reviews yet. The window opens on an engagement once a payment on it
        has actually been released.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {reviews.map((r) => {
        // Sealed means "nobody outside staff can see this", and reveal_at alone
        // does not say that: a pair where BOTH sides have submitted is live
        // immediately, thirty days before its anchor. Badging those as sealed
        // told a moderator that an abusive review already on a public profile
        // and already counting toward a reputation score was harmless, which is
        // the one thing this screen must not do.
        const paired = reviews.some(
          (o) => o.engagement_id === r.engagement_id && o.direction !== r.direction
        );
        const sealed = !paired && new Date(r.reveal_at) > new Date();
        return (
          <div
            key={r.id}
            style={{
              background: "#fff",
              border: "1px solid #E5E2DC",
              borderRadius: 8,
              padding: 14,
              opacity: r.published ? 1 : 0.6,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>
                <span style={{ fontSize: 12, fontWeight: 600 }}>
                  {DIRECTION_LABEL[r.direction]}
                </span>
                <span style={{ fontSize: 12, color: "#6B6862", marginLeft: 8 }}>
                  {"★".repeat(r.rating)}
                  <span style={{ color: "#D5D1C9" }}>{"★".repeat(5 - r.rating)}</span>
                </span>
                {sealed && (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 11,
                      background: "#FEF0C7",
                      color: "#93370D",
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}
                  >
                    sealed until {new Date(r.reveal_at).toLocaleDateString()}
                  </span>
                )}
                {!sealed && r.published && (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 11,
                      background: "#DCFAE6",
                      color: "#085D3A",
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}
                  >
                    live
                  </span>
                )}
                {!r.published && (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 11,
                      background: "#FEE4E2",
                      color: "#B42318",
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}
                  >
                    taken down
                  </span>
                )}
              </div>
              <button
                onClick={() => setPublished(r.id, !r.published)}
                disabled={busy === r.id}
                style={{
                  fontSize: 12,
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: "1px solid #E5E2DC",
                  background: "#fff",
                  cursor: "pointer",
                }}
              >
                {busy === r.id ? "Saving…" : r.published ? "Take down" : "Restore"}
              </button>
            </div>
            {r.body && (
              <p style={{ fontSize: 13, marginTop: 8, color: "#3A3833", whiteSpace: "pre-wrap" }}>
                {r.body}
              </p>
            )}
            <p style={{ fontSize: 11, color: "#8A8781", marginTop: 8, fontFamily: "'DM Mono', monospace" }}>
              engagement {r.engagement_id.slice(0, 8)} · submitted{" "}
              {new Date(r.submitted_at).toLocaleString()}
            </p>
          </div>
        );
      })}
    </div>
  );
}
