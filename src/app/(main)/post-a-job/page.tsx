"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DM_Serif_Display } from "next/font/google";
import { SKILLS_BY_ROLE, ALL_ROLES } from "@/lib/roleSkills";

const serif = DM_Serif_Display({ subsets: ["latin"], weight: "400" });

/**
 * The AI job composer. A client describes what they need in plain words; the
 * draft comes back structured and fully editable; publish leads straight to a
 * matched shortlist with voice samples — the payoff moment.
 *
 * Anonymous until publish: the draft lives in localStorage, so signing in
 * never costs the client their work.
 */

interface JobDraft {
  title: string;
  role_category: string;
  summary: string;
  responsibilities: string[];
  must_have_skills: string[];
  nice_to_have_skills: string[];
  hours_per_week_estimate: string;
  duration_type: "ongoing" | "project";
  duration_estimate: string;
  experience_level: "any" | "junior" | "mid" | "senior";
  rate_type: "hourly" | "fixed";
  hourly_rate_min: number | null;
  hourly_rate_max: number | null;
  fixed_budget: number | null;
  follow_up_question: string | null;
}

const STORAGE_KEY = "staffva-job-composer";
const EXAMPLES = [
  "A bookkeeper for my Shopify store, reconciliation and monthly close, about 10 hours a week",
  "Someone to answer customer support emails on US evening hours, ongoing",
  "A paralegal for a 3-month document review project, must know eDiscovery",
];
const HOURS_BUCKETS = ["Full Time (40 hrs)", "Part Time (20 hrs)", "Flexible (10-15 hrs)", "Project Based"];
const LEVELS: { value: JobDraft["experience_level"]; label: string }[] = [
  { value: "any", label: "Any level" },
  { value: "junior", label: "Junior" },
  { value: "mid", label: "Mid-level" },
  { value: "senior", label: "Senior" },
];
export default function PostAJobPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<"brief" | "drafting" | "edit" | "publishing">("brief");
  const [brief, setBrief] = useState("");
  const [draft, setDraft] = useState<JobDraft | null>(null);
  const [error, setError] = useState("");
  const [refusal, setRefusal] = useState("");
  const [rewriting, setRewriting] = useState<string | null>(null);
  const [followUpAnswer, setFollowUpAnswer] = useState("");
  const [startDate, setStartDate] = useState("Immediately");
  const [newSkill, setNewSkill] = useState("");
  const hydratedRef = useRef(false);

  // Restore an in-flight draft (e.g. the client left to sign in)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.brief) setBrief(parsed.brief);
        if (parsed.draft) {
          setDraft(parsed.draft);
          setPhase("edit");
        }
      }
    } catch { /* fresh start */ }
    hydratedRef.current = true;
  }, []);

  // Persist continuously — but never before restoration has run, and never an
  // empty state over a saved one. The first version of this effect fired on
  // mount with the initial empty state and clobbered the very draft the
  // restore effect was about to read: a client returning from sign-in would
  // have found their work gone.
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (!brief && !draft) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ brief, draft }));
    } catch { /* storage unavailable */ }
  }, [brief, draft]);

  async function requestDraft(instruction?: string, extraBrief?: string) {
    setError("");
    setRefusal("");
    const effectiveBrief = extraBrief ? `${brief}\n\nAdditional detail: ${extraBrief}` : brief;
    if (extraBrief) setBrief(effectiveBrief);

    const isRewrite = !!instruction && !!draft;
    if (isRewrite) setRewriting(instruction!);
    else setPhase("drafting");

    try {
      const res = await fetch("/api/jobs/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isRewrite
            ? { brief: effectiveBrief, currentDraft: draft, instruction }
            : { brief: effectiveBrief }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        setPhase(draft ? "edit" : "brief");
        return;
      }
      if (data.refusal) {
        setRefusal(data.refusal);
        setPhase("brief");
        return;
      }
      setDraft(data.draft);
      setFollowUpAnswer("");
      setPhase("edit");
    } catch {
      setError("We could not reach the server. Please try again.");
      setPhase(draft ? "edit" : "brief");
    } finally {
      setRewriting(null);
    }
  }

  function update<K extends keyof JobDraft>(key: K, value: JobDraft[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  function addSkill(list: "must_have_skills" | "nice_to_have_skills", skill: string) {
    const s = skill.trim();
    if (!s || !draft) return;
    const existing = [...draft.must_have_skills, ...draft.nice_to_have_skills].map((x) => x.toLowerCase());
    if (existing.includes(s.toLowerCase())) return;
    update(list, [...draft[list], s].slice(0, list === "must_have_skills" ? 5 : 4));
    setNewSkill("");
  }

  async function publish() {
    if (!draft) return;
    setError("");
    setPhase("publishing");
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      // Draft is already in localStorage; bring them back here after sign-in.
      router.push(`/login?next=${encodeURIComponent("/post-a-job")}`);
      return;
    }
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ draft, brief, start_date: startDate }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Publishing failed. Please try again.");
        setPhase("edit");
        return;
      }
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.setItem("job_post_result", JSON.stringify(data));
      router.push(`/post-role/shortlist?id=${data.jobPost.id}`);
    } catch {
      setError("Publishing failed. Please try again.");
      setPhase("edit");
    }
  }

  const roleSkillSuggestions =
    draft && SKILLS_BY_ROLE[draft.role_category]
      ? SKILLS_BY_ROLE[draft.role_category].filter(
          (s) =>
            ![...draft.must_have_skills, ...draft.nice_to_have_skills]
              .map((x) => x.toLowerCase())
              .includes(s.toLowerCase())
        )
      : [];

  // ── Brief phase ──────────────────────────────────────────────────────────
  if (phase === "brief" || phase === "drafting") {
    const drafting = phase === "drafting";
    return (
      <main className="mx-auto max-w-2xl px-6 pb-24 pt-16">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
          Post a job
        </p>
        <h1 className={`${serif.className} text-4xl text-text sm:text-5xl`}>
          Who are you hiring?
        </h1>
        <p className="mt-3 max-w-md text-[15px] leading-relaxed text-text-secondary">
          Plain words are fine. A couple of sentences about the work, the hours,
          and what you&apos;d like to pay.
        </p>

        <div className="mt-10">
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            disabled={drafting}
            rows={4}
            maxLength={2000}
            autoFocus
            placeholder="I run a small law firm and need help preparing discovery documents…"
            className="w-full resize-none border-0 border-b border-border bg-transparent pb-3 text-lg leading-relaxed text-text placeholder:text-text-tertiary/70 focus:border-text focus:outline-none disabled:opacity-60"
          />
          {drafting && <div className="h-px w-full animate-pulse bg-primary" />}
        </div>

        {refusal && (
          <p className="mt-5 border-l-2 border-border pl-4 text-sm leading-relaxed text-text-secondary">
            {refusal}
          </p>
        )}
        {error && <p className="mt-5 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex items-center justify-between gap-4">
          <p className="text-xs text-text-tertiary">
            {drafting ? "Writing your post…" : "Nothing is posted until you say so."}
          </p>
          <button
            onClick={() => requestDraft()}
            disabled={drafting || brief.trim().length < 10}
            className="rounded-full bg-primary px-7 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-40"
          >
            {drafting ? "Writing…" : "Write the post"}
          </button>
        </div>

        <div className="mt-16 border-t border-border pt-8">
          <p className="mb-4 text-xs font-medium uppercase tracking-[0.12em] text-text-tertiary">
            For example
          </p>
          <div className="space-y-3">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => setBrief(ex)}
                disabled={drafting}
                className="block text-left text-[15px] leading-snug text-text-secondary underline decoration-border underline-offset-4 transition-colors hover:text-text hover:decoration-primary"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      </main>
    );
  }

  // ── Edit phase ───────────────────────────────────────────────────────────
  if (!draft) return null;

  const chip = (selected: boolean) =>
    selected
      ? "rounded-full bg-text px-4 py-1.5 text-xs font-semibold text-white"
      : "rounded-full border border-border px-4 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-text-tertiary";

  const label = "mb-1.5 block text-xs font-medium text-text/50";

  return (
    <main className="mx-auto max-w-5xl px-6 pb-24 pt-12">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            Post a job
          </p>
          <h1 className={`${serif.className} text-3xl text-text sm:text-4xl`}>Your job post</h1>
          <p className="mt-2 text-[15px] text-text-secondary">
            Change anything. Publish when it reads right.
          </p>
        </div>
        <button
          onClick={() => {
            setDraft(null);
            setPhase("brief");
          }}
          className="text-sm text-text-tertiary underline decoration-border underline-offset-4 transition-colors hover:text-text"
        >
          Start over
        </button>
      </div>

      {draft.follow_up_question && (
        <div className="mb-8 max-w-2xl border-l-2 border-text pl-5">
          <p className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-text-tertiary">
            One question
          </p>
          <p className="text-[15px] text-text">{draft.follow_up_question}</p>
          <div className="mt-3 flex gap-2">
            <input
              value={followUpAnswer}
              onChange={(e) => setFollowUpAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && followUpAnswer.trim()) requestDraft(undefined, followUpAnswer.trim());
              }}
              placeholder="Answer in a few words"
              className="w-full max-w-sm rounded-lg border border-border bg-card px-3 py-2 text-sm text-text placeholder:text-text-tertiary/70 focus:border-text focus:outline-none"
            />
            <button
              onClick={() => followUpAnswer.trim() && requestDraft(undefined, followUpAnswer.trim())}
              disabled={!followUpAnswer.trim() || !!rewriting}
              className="rounded-full bg-text px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              {rewriting ? "…" : "Update"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mb-6 text-sm text-red-600">{error}</p>}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* ── The post, as a document ── */}
        <article className="rounded-xl border border-border bg-card px-8 py-9 sm:px-10">
          <textarea
            value={draft.title}
            onChange={(e) => update("title", e.target.value.replace(/\n/g, " "))}
            maxLength={90}
            rows={2}
            className={`${serif.className} w-full resize-none border-0 bg-transparent text-[26px] leading-tight text-text focus:outline-none sm:text-3xl`}
            placeholder="Job title"
          />
          <p className="mt-2 text-xs uppercase tracking-[0.1em] text-text-tertiary">
            {draft.role_category} · {draft.hours_per_week_estimate} · {draft.duration_estimate}
          </p>

          <div className="mt-8">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-text-tertiary">
              About the role
            </p>
            <textarea
              value={draft.summary}
              onChange={(e) => update("summary", e.target.value)}
              rows={4}
              maxLength={600}
              className="w-full resize-none border-0 bg-transparent text-[15px] leading-relaxed text-text-secondary focus:outline-none"
            />
            <p className="text-xs text-text-tertiary">
              Rewrite:{" "}
              {["shorter", "friendlier", "more specific"].map((mode, i) => (
                <span key={mode}>
                  {i > 0 && " · "}
                  <button
                    onClick={() => requestDraft(`Rewrite the summary to be ${mode}. Keep everything else unchanged.`)}
                    disabled={!!rewriting}
                    className="underline decoration-border underline-offset-2 transition-colors hover:text-text disabled:opacity-40"
                  >
                    {rewriting?.includes(mode) ? "…" : mode}
                  </button>
                </span>
              ))}
            </p>
          </div>

          <div className="mt-8">
            <p className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-text-tertiary">
              What you&apos;ll do
            </p>
            <div>
              {draft.responsibilities.map((r, i) => (
                <div key={i} className="group flex items-center gap-3 border-b border-border-light/60 py-1.5 last:border-b-0">
                  <span className="text-text-tertiary">–</span>
                  <input
                    value={r}
                    onChange={(e) => {
                      const next = [...draft.responsibilities];
                      next[i] = e.target.value;
                      update("responsibilities", next);
                    }}
                    maxLength={120}
                    className="w-full border-0 bg-transparent py-0.5 text-[15px] text-text-secondary focus:outline-none"
                  />
                  <button
                    onClick={() => update("responsibilities", draft.responsibilities.filter((_, j) => j !== i))}
                    className="text-text-tertiary opacity-0 transition-opacity hover:text-text group-hover:opacity-100"
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            {draft.responsibilities.length < 6 && (
              <button
                onClick={() => update("responsibilities", [...draft.responsibilities, ""])}
                className="mt-2 text-xs text-text-tertiary underline decoration-border underline-offset-2 hover:text-text"
              >
                Add a line
              </button>
            )}
          </div>

          <div className="mt-8">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-text-tertiary">
              Skills
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {draft.must_have_skills.map((sk) => (
                <button
                  key={sk}
                  onClick={() => update("must_have_skills", draft.must_have_skills.filter((x) => x !== sk))}
                  title="Click to remove"
                  className="group rounded-full bg-text px-3 py-1 text-xs font-medium text-white"
                >
                  {sk} <span className="opacity-50 group-hover:opacity-100">×</span>
                </button>
              ))}
              {draft.nice_to_have_skills.map((sk) => (
                <button
                  key={sk}
                  onClick={() => update("nice_to_have_skills", draft.nice_to_have_skills.filter((x) => x !== sk))}
                  title="Click to remove"
                  className="group rounded-full border border-border px-3 py-1 text-xs text-text-secondary"
                >
                  {sk} <span className="text-text-tertiary">· optional</span>{" "}
                  <span className="opacity-40 group-hover:opacity-100">×</span>
                </button>
              ))}
              <input
                value={newSkill}
                onChange={(e) => setNewSkill(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addSkill("must_have_skills", newSkill);
                }}
                placeholder="Add a skill"
                className="w-28 border-0 border-b border-border bg-transparent px-1 py-1 text-xs text-text placeholder:text-text-tertiary/70 focus:border-text focus:outline-none"
              />
            </div>
            {roleSkillSuggestions.length > 0 && (
              <p className="mt-3 text-xs leading-relaxed text-text-tertiary">
                Common for this role:{" "}
                {roleSkillSuggestions.slice(0, 6).map((sk, i) => (
                  <span key={sk}>
                    {i > 0 && " · "}
                    <button
                      onClick={() => addSkill("must_have_skills", sk)}
                      className="underline decoration-border underline-offset-2 transition-colors hover:text-text"
                    >
                      {sk}
                    </button>
                  </span>
                ))}
              </p>
            )}
          </div>
        </article>

        {/* ── The terms ── */}
        <aside className="space-y-6 self-start rounded-xl border border-border bg-card p-5 lg:sticky lg:top-24">
          <div>
            <span className={label}>Role category</span>
            <select
              value={draft.role_category}
              onChange={(e) => update("role_category", e.target.value)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text focus:border-text focus:outline-none"
            >
              {ALL_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <span className={label}>Pay</span>
            <div className="mb-2 flex gap-1.5">
              <button className={chip(draft.rate_type === "hourly")} onClick={() => update("rate_type", "hourly")}>
                Hourly rate
              </button>
              <button className={chip(draft.rate_type === "fixed")} onClick={() => update("rate_type", "fixed")}>
                Project budget
              </button>
            </div>
            {draft.rate_type === "hourly" ? (
              <div className="flex items-center gap-2">
                <div className="relative w-full">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-tertiary">$</span>
                  <input
                    type="number"
                    min={3}
                    max={500}
                    value={draft.hourly_rate_min ?? ""}
                    onChange={(e) => update("hourly_rate_min", e.target.value ? Number(e.target.value) : null)}
                    className="w-full rounded-lg border border-border bg-card py-2 pl-7 pr-2 text-sm text-text focus:border-text focus:outline-none"
                  />
                </div>
                <span className="text-text-tertiary">–</span>
                <div className="relative w-full">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-tertiary">$</span>
                  <input
                    type="number"
                    min={3}
                    max={500}
                    value={draft.hourly_rate_max ?? ""}
                    onChange={(e) => update("hourly_rate_max", e.target.value ? Number(e.target.value) : null)}
                    className="w-full rounded-lg border border-border bg-card py-2 pl-7 pr-2 text-sm text-text focus:border-text focus:outline-none"
                  />
                </div>
                <span className="whitespace-nowrap text-xs text-text-tertiary">/hr</span>
              </div>
            ) : (
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-tertiary">$</span>
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={draft.fixed_budget ?? ""}
                  onChange={(e) => update("fixed_budget", e.target.value ? Number(e.target.value) : null)}
                  placeholder="Total for the project"
                  className="w-full rounded-lg border border-border bg-card py-2 pl-7 pr-3 text-sm text-text placeholder:text-text-tertiary/70 focus:border-text focus:outline-none"
                />
              </div>
            )}
          </div>

          <div>
            <span className={label}>Hours per week</span>
            <div className="flex flex-wrap gap-1.5">
              {HOURS_BUCKETS.map((h) => (
                <button key={h} className={chip(draft.hours_per_week_estimate === h)} onClick={() => update("hours_per_week_estimate", h)}>
                  {h.replace(/ \(.*\)/, "")}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className={label}>Duration</span>
            <div className="mb-2 flex gap-1.5">
              <button className={chip(draft.duration_type === "ongoing")} onClick={() => { update("duration_type", "ongoing"); update("duration_estimate", "Ongoing"); }}>
                Ongoing
              </button>
              <button className={chip(draft.duration_type === "project")} onClick={() => update("duration_type", "project")}>
                Project
              </button>
            </div>
            {draft.duration_type === "project" && (
              <input
                value={draft.duration_estimate}
                onChange={(e) => update("duration_estimate", e.target.value)}
                maxLength={60}
                placeholder="About 3 months"
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text placeholder:text-text-tertiary/70 focus:border-text focus:outline-none"
              />
            )}
          </div>

          <div>
            <span className={label}>Experience</span>
            <div className="flex flex-wrap gap-1.5">
              {LEVELS.map((l) => (
                <button key={l.value} className={chip(draft.experience_level === l.value)} onClick={() => update("experience_level", l.value)}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className={label}>Start</span>
            <div className="flex flex-wrap gap-1.5">
              {["Immediately", "Within 2 weeks", "Within a month"].map((sd) => (
                <button key={sd} className={chip(startDate === sd)} onClick={() => setStartDate(sd)}>
                  {sd}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-border-light pt-5">
            <button
              onClick={publish}
              disabled={phase === "publishing" || !draft.title.trim()}
              className="w-full rounded-full bg-primary py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-40"
            >
              {phase === "publishing" ? "Publishing…" : "Publish this job"}
            </button>
            <p className="mt-3 text-xs leading-relaxed text-text-tertiary">
              {/* This sentence was false until step 14: no candidate could see a
                  job post at all, because nothing rendered one. It is true now,
                  and the 45 days is the window job_is_open() enforces — the
                  number is defined in SQL and stated here, nowhere else. */}
              Only candidates matching this role or its skills see it, and it
              stays on their work page for 45 days. You&apos;ll get a shortlist
              of matches the moment it&apos;s live.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
