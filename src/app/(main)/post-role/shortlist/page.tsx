"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { MatchCriterion } from "@/lib/jobMatch";
import "@/app/landing.css";

type Pipeline = "passed" | "accepted" | "offer" | "interviewing" | "contacted" | "new";

interface MatchedCandidate {
  id: string;
  display_name: string;
  country: string;
  role_category: string;
  hourly_rate: number | null;
  profile_photo_url: string | null;
  bio: string | null;
  match_score: number;
  criteria: MatchCriterion[];
  /** Set when the marketplace has withdrawn them; directory fields are blanked. */
  withdrawn: string | null;
  invited_at?: string | null;
  passed_at?: string | null;
  pipeline: Pipeline;
}

interface JobPost {
  id: string;
  title: string | null;
  role_category: string;
  must_have_skills: string[] | null;
  nice_to_have_skills: string[] | null;
  rate_type: string | null;
  hourly_rate_min: number | null;
  hourly_rate_max: number | null;
  hours_per_week_estimate: string | null;
  duration_type: string | null;
  duration_estimate: string | null;
  published_at: string | null;
  status: string;
}

const PIPELINE_LABEL: Record<Pipeline, string> = {
  new: "New",
  contacted: "Contacted",
  interviewing: "Interviewing",
  offer: "Offer out",
  // Distinct from "Offer out": an accepted offer is the opposite of one still
  // outstanding, and collapsing the two told a client to chase a reply they
  // had already had.
  accepted: "Offer accepted",
  passed: "Passed",
};

/**
 * Match results (client step 9).
 *
 * The page Atlas calls "match results". Two things it deliberately does NOT
 * do, both of which the prototype does:
 *
 *  - No Talent Specialist, and no "we'll source 1-2 more within 24-48 hours".
 *    The owner retired the specialist (D5) and nobody sources off-platform.
 *    Atlas repeats that promise five times on this one screen.
 *  - No freeform "why we matched" prose. Atlas's asserts cross-record facts
 *    ("her proposal landed this morning", "you're already negotiating with
 *    Diego") that nothing checks. The criteria grid below says the same kind
 *    of thing, except every row is a column we actually read.
 *
 * The score is recomputed live from the candidate's current row, so the
 * number and the rows explaining it always agree.
 */
function ShortlistContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = searchParams.get("id");

  const [jobPost, setJobPost] = useState<JobPost | null>(null);
  const [matches, setMatches] = useState<MatchedCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Pipeline | "all">("all");
  const [inviting, setInviting] = useState<string | null>(null);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [busyPass, setBusyPass] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const [signalsOk, setSignalsOk] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!jobId) {
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(`/api/jobs/shortlist?id=${encodeURIComponent(jobId)}`);
        // Every failure used to collapse into "No results found" plus a
        // "Post a Role" CTA — steering a client with a LIVE post into
        // publishing a duplicate because their cookie expired.
        if (res.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(`/post-role/shortlist?id=${jobId}`)}`);
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (!cancelled) setLoadError(body.error || "Could not load your matches.");
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setJobPost(data.jobPost);
        setMatches(data.matches || []);
        setSignalsOk(data.signalsOk !== false);
        setInvited(
          new Set((data.matches as MatchedCandidate[]).filter((m) => m.invited_at).map((m) => m.id))
        );
      } catch {
        if (!cancelled) setLoadError("Could not reach the server.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [jobId, router]);

  // Counts are computed from the rows on screen, every render. Atlas hardcodes
  // its five pipeline numbers in HTML and never recomputes them, so its
  // "Passed 0" stays 0 no matter what you do.
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: matches.length, new: 0, contacted: 0, interviewing: 0, offer: 0, passed: 0 };
    for (const m of matches) c[m.pipeline] = (c[m.pipeline] || 0) + 1;
    return c;
  }, [matches]);

  const visible = filter === "all" ? matches : matches.filter((m) => m.pipeline === filter);

  async function handleInvite(candidateId: string) {
    setInviting(candidateId);
    setActionError(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // Returning silently here left the button dead with no explanation.
        setActionError({ id: candidateId, message: "Your session expired — reload and try again." });
        return;
      }
      const res = await fetch("/api/jobs/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ job_post_id: jobId, candidate_id: candidateId }),
      });
      // fetch does not reject on 4xx/5xx, and this used to mark the candidate
      // invited regardless — so a 404 still rendered "✓ Invited".
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError({ id: candidateId, message: body.error || "Could not send that invite." });
        return;
      }
      setInvited((prev) => new Set(prev).add(candidateId));
      setMatches((prev) =>
        prev.map((m) =>
          m.id === candidateId && m.pipeline === "new" ? { ...m, pipeline: "contacted" } : m
        )
      );
    } catch {
      setActionError({ id: candidateId, message: "Could not reach the server." });
    } finally {
      setInviting(null);
    }
  }

  async function handlePass(candidateId: string, passed: boolean) {
    setBusyPass(candidateId);
    setActionError(null);
    try {
      const res = await fetch("/api/jobs/shortlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobPostId: jobId, candidateId, passed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError({ id: candidateId, message: body.error || "Could not save that." });
        return;
      }
      // Un-passing returns them to a DERIVED state, which only the server can
      // work out — so refetch rather than guessing "new".
      const reload = await fetch(`/api/jobs/shortlist?id=${encodeURIComponent(jobId as string)}`);
      if (!reload.ok) {
        // The write LANDED; only the refresh failed. Saying nothing left the
        // button reading "Pass" for a candidate who was already passed.
        setActionError({ id: candidateId, message: "Saved, but the list didn't refresh. Reload to see it." });
        return;
      }
      const data = await reload.json();
      const fresh: MatchedCandidate[] = data.matches || [];
      setMatches(fresh);
      setSignalsOk(data.signalsOk !== false);
      // Re-derived, not left stale: "✓ Invited" would otherwise disagree with
      // the invited_at just fetched.
      setInvited(new Set(fresh.filter((m) => m.invited_at).map((m) => m.id)));
    } catch {
      setActionError({ id: candidateId, message: "Could not reach the server." });
    } finally {
      setBusyPass(null);
    }
  }

  if (loading) {
    return <div className="mr-state">Loading your matches…</div>;
  }

  if (loadError) {
    return (
      <div className="mr-state">
        <h1>Couldn&apos;t load your matches</h1>
        <p>{loadError}</p>
        <p className="mr-state-sub">
          Your post and its matches are safe — this is a loading problem, not a missing shortlist.
        </p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>Try again</button>
      </div>
    );
  }

  if (!jobPost) {
    // Two different situations. Asserting "it may have been removed" for a
    // link that simply carried no id claims a deletion that never happened.
    return (
      <div className="mr-state">
        <h1>{jobId ? "No role found" : "No role selected"}</h1>
        <p>
          {jobId
            ? "We couldn't find that post. It may have been removed."
            : "This page shows the matches for one job post. Open it from the post, or start a new one."}
        </p>
        <Link href="/post-a-job" className="btn btn-primary">Post a role</Link>
      </div>
    );
  }

  // No invented $0 floor: the client never said zero, and the scorer's budget
  // evidence is worded the same way when there is no minimum.
  const rateLabel =
    jobPost.rate_type === "hourly" && jobPost.hourly_rate_max != null
      ? jobPost.hourly_rate_min != null
        ? `$${jobPost.hourly_rate_min}–$${jobPost.hourly_rate_max}/hr`
        : `Up to $${jobPost.hourly_rate_max}/hr`
      : jobPost.rate_type === "fixed"
        ? "Fixed price"
        : "Not set";

  return (
    <div className="mr">
      <div className="mr-head">
        <div>
          <div className="mr-eyebrow">Hiring on StaffVA · Matches</div>
          <h1 className="mr-title">{jobPost.title || jobPost.role_category}</h1>
          <p className="mr-lead">
            {matches.length === 0
              ? "Nobody on StaffVA matches this post yet."
              : `${matches.length} ${matches.length === 1 ? "candidate" : "candidates"} matched, ranked by fit against your spec. Every score below breaks down into the checks that produced it.`}
          </p>
        </div>
        <div className="mr-head-actions">
          <Link href="/post-a-job" className="btn btn-outline">Post another role</Link>
        </div>
      </div>

      <div className="mr-body">
        <div className="mr-main">
          {/* Counts recomputed from the rows on screen every render. */}
          <div className="mr-pipeline" role="tablist" aria-label="Filter by stage">
            {(["all", "new", "contacted", "interviewing", "offer", "passed"] as const).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={filter === k}
                className={`mr-pipeline-cell${filter === k ? " active" : ""}`}
                onClick={() => setFilter(k)}
              >
                <span className={`mr-pipeline-num${(counts[k] ?? 0) === 0 ? " zero" : ""}`}>{counts[k] ?? 0}</span>
                <span className="mr-pipeline-lbl">{k === "all" ? "All matches" : PIPELINE_LABEL[k]}</span>
              </button>
            ))}
          </div>
          <p className="mr-pipeline-note">
            Stages describe where you are with each person overall — a message, interview or
            offer counts even if it was for another role, because none of those records name a
            job. &ldquo;Passed&rdquo; and an invite sent from this page are specific to this post.
          </p>
          {!signalsOk && (
            // Better than showing everyone as "New", which would send a client
            // to re-contact people they already have an offer out to.
            <p className="mr-signals-warn">
              We couldn&apos;t check every stage just now, so some cards may look earlier in the
              process than they are. Match scores below are unaffected.
            </p>
          )}

          {visible.length === 0 ? (
            <div className="mr-empty">
              {matches.length === 0 ? (
                <>
                  <p>No candidates matched this post.</p>
                  <Link href={`/browse?role=${encodeURIComponent(jobPost.role_category)}`} className="btn btn-outline">
                    Browse {jobPost.role_category} candidates
                  </Link>
                </>
              ) : filter === "passed" ? (
                <p>No passed candidates yet. Anyone you mark as a no shows up here, and you can bring them back.</p>
              ) : (
                <p>Nobody is at that stage yet.</p>
              )}
            </div>
          ) : (
            visible.map((m) => (
                <article key={m.id} className={`mr-card${m.passed_at ? " passed" : ""}${m.withdrawn ? " gone" : ""}`}>
                  <div className="mr-card-top">
                    <div
                      className="mr-card-photo"
                      style={m.profile_photo_url ? { backgroundImage: `url("${encodeURI(m.profile_photo_url)}")` } : undefined}
                      aria-hidden
                    >
                      {!m.profile_photo_url && (m.display_name?.[0] || "?").toUpperCase()}
                    </div>
                    <div className="mr-card-id">
                      <div className="mr-card-name">{m.display_name}</div>
                      {m.withdrawn ? (
                        <div className="mr-card-gone">{m.withdrawn}</div>
                      ) : (
                        <div className="mr-card-role">
                          {[m.role_category, m.country, m.hourly_rate != null ? `$${m.hourly_rate}/hr` : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      )}
                      <span className={`mr-card-status st-${m.pipeline}`}>{PIPELINE_LABEL[m.pipeline]}</span>
                    </div>
                    {!m.withdrawn && (
                      <div className="mr-card-score">
                        <div className="mr-card-score-num">{m.match_score}<span className="denom">/100</span></div>
                        <div className="mr-card-score-bar"><span style={{ width: `${m.match_score}%` }} /></div>
                        <div className="mr-card-score-label">Match score</div>
                      </div>
                    )}
                  </div>

                  {/* Every check, always. Truncating them left a headline the
                      visible rows could not add up to — and the whole point of
                      this grid is that the score reconciles. */}
                  <div className="mr-card-criteria">
                    {m.criteria.map((c) => (
                      <div key={c.key} className={`mr-criterion ${c.verdict}`}>
                        {/* The word, not just the colour: the mark alone left
                            met/partial/miss indistinguishable without colour. */}
                        <span className="mr-criterion-mark" aria-hidden />
                        <span className="mr-criterion-body">
                          <span className="mr-criterion-label">
                            {c.label}
                            <span className="sr-only">
                              {c.verdict === "met" ? " — met" : c.verdict === "partial" ? " — partly met" : " — not met"}
                            </span>
                          </span>
                          <span className="mr-criterion-evidence">{c.evidence}</span>
                        </span>
                        <span className="mr-criterion-pts">{c.points}/{c.maxPoints}</span>
                      </div>
                    ))}
                  </div>

                  <div className="mr-card-actions">
                    {!m.withdrawn && (
                      <>
                        <Link href={`/candidate/${m.id}`} className="btn btn-outline">View profile</Link>
                        <Link href={`/inbox?candidate=${m.id}`} className="btn btn-outline">Message</Link>
                      </>
                    )}
                    {!m.withdrawn && (
                      <button
                        className="btn btn-primary"
                        onClick={() => handleInvite(m.id)}
                        disabled={inviting === m.id || invited.has(m.id)}
                      >
                        {invited.has(m.id) ? "✓ Invited" : inviting === m.id ? "Sending…" : "Invite to role"}
                      </button>
                    )}
                    <button
                      className="mr-pass"
                      onClick={() => handlePass(m.id, !m.passed_at)}
                      disabled={busyPass === m.id}
                    >
                      {busyPass === m.id ? "…" : m.passed_at ? "Undo pass" : "Pass"}
                    </button>
                  </div>
                  {actionError?.id === m.id && <p className="mr-card-err">{actionError.message}</p>}
                </article>
            ))
          )}
        </div>

        <aside className="mr-side">
          <div className="mr-spec-card">
            <div className="mr-spec-head">
              <h2>Job spec</h2>
              <span className={`mr-spec-status st-${jobPost.status}`}>{jobPost.status}</span>
            </div>
            <div className="mr-spec-rows">
              <div><span>Role</span><span>{jobPost.role_category}</span></div>
              <div><span>Budget</span><span>{rateLabel}</span></div>
              {jobPost.hours_per_week_estimate && (
                <div><span>Hours</span><span>{jobPost.hours_per_week_estimate}</span></div>
              )}
              {jobPost.duration_type && (
                <div>
                  <span>Length</span>
                  <span>{jobPost.duration_type}{jobPost.duration_estimate ? ` · ${jobPost.duration_estimate}` : ""}</span>
                </div>
              )}
              {jobPost.published_at && (
                <div>
                  <span>Posted</span>
                  <span>{new Date(jobPost.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                </div>
              )}
            </div>
            {(jobPost.must_have_skills || []).length > 0 && (
              <>
                <div className="mr-spec-sub">Must have</div>
                <div className="mr-spec-chips">
                  {(jobPost.must_have_skills || []).map((s) => <span key={s} className="skill-mini">{s}</span>)}
                </div>
              </>
            )}
            {(jobPost.nice_to_have_skills || []).length > 0 && (
              <>
                <div className="mr-spec-sub">Nice to have</div>
                <div className="mr-spec-chips">
                  {(jobPost.nice_to_have_skills || []).map((s) => <span key={s} className="skill-mini">{s}</span>)}
                </div>
              </>
            )}
            {/* Hours is shown here rather than as a scored criterion: the
                column is free text ("about 20 hrs"), so a met/miss verdict on
                it would be a parse dressed up as a fact. */}
            <p className="mr-spec-note">
              Every check on a card carries its own points, and they add up to the score beside
              it. A check we can&apos;t make — budget on a fixed-price post, say — is left out
              rather than guessed at, so it neither helps nor hurts. Hours aren&apos;t scored
              either: the field is free text.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function ShortlistPage() {
  return (
    // `.lp` scopes the Atlas tokens these styles use. No nav or footer here:
    // the (main) layout already renders the site Navbar, and adding Atlas's
    // would put two on the page.
    <div className="lp">
      <Suspense fallback={<div className="mr-state">Loading…</div>}>
        <ShortlistContent />
      </Suspense>
    </div>
  );
}
