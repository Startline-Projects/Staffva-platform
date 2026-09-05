"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * The client's posted roles — the list that never existed. A published post
 * stays candidate-visible for 45 days, but the client's only view of who
 * matched lived in sessionStorage: close the tab and the shortlist, and the
 * ability to invite anyone, were gone. This section is the way back in.
 */

interface RolePost {
  id: string;
  title: string | null;
  role_category: string | null;
  status: string;
  published_at: string | null;
  matches: number;
  invited: number;
  expires_at: string | null;
  visible_to_candidates: boolean;
}

export default function RolePosts() {
  const [posts, setPosts] = useState<RolePost[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/jobs/mine");
        if (!res.ok) return;
        const j = await res.json();
        if (!cancelled) setPosts(j.posts || []);
      } catch {
        /* section stays hidden */
      }
    }
    const t = setTimeout(load, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  // Nothing posted -> nothing rendered; the post-a-job CTA lives elsewhere.
  if (!posts || posts.length === 0) return null;

  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold text-text/40 uppercase tracking-wider">
        Your Role Posts ({posts.length})
      </h2>
      <div className="mt-4 space-y-3">
        {posts.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-card px-6 py-4"
          >
            <div className="min-w-0">
              <p className="font-medium text-text">
                {p.title || p.role_category || "Role post"}
              </p>
              <p className="mt-0.5 text-xs text-text/60">
                {p.visible_to_candidates ? (
                  <>
                    Live to candidates
                    {p.expires_at
                      ? ` until ${new Date(p.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                      : ""}
                  </>
                ) : p.published_at ? (
                  "No longer visible to candidates (45-day window passed)"
                ) : (
                  "Not published"
                )}
                {" · "}
                {p.matches} match{p.matches === 1 ? "" : "es"}
                {p.invited > 0 ? ` · ${p.invited} invited` : ""}
              </p>
            </div>
            <Link
              href={`/post-role/shortlist?id=${p.id}`}
              className="shrink-0 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-text hover:bg-gray-50 transition-colors"
            >
              View shortlist
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
