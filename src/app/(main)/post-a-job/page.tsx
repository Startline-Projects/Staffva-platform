"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SKILLS_BY_ROLE, ALL_ROLES } from "@/lib/roleSkills";

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
  "A bookkeeper for my Shopify store — reconciliation and monthly close, about 10 hours a week",
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
const DRAFTING_LINES = [
  "Reading your brief…",
  "Picking the right role…",
  "Checking rates on the marketplace…",
  "Writing the post…",
];

export default function PostAJobPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<"brief" | "drafting" | "edit" | "publishing">("brief");
  const [brief, setBrief] = useState("");
  const [draft, setDraft] = useState<JobDraft | null>(null);
  const [error, setError] = useState("");
  const [refusal, setRefusal] = useState("");
  const [draftingLine, setDraftingLine] = useState(0);
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

  // Rotate the drafting status line
  useEffect(() => {
    if (phase !== "drafting") return;
    setDraftingLine(0);
    const t = setInterval(() => setDraftingLine((i) => Math.min(i + 1, DRAFTING_LINES.length - 1)), 2600);
    return () => clearInterval(t);
  }, [phase]);

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
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-3xl font-bold text-text">Post a job</h1>
        <p className="mt-2 text-text/60">
          Describe who you need, in your own words. We&apos;ll turn it into a job post you can edit.
        </p>

        {refusal && (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{refusal}</div>
        )}
        {error && (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        )}

        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          maxLength={2000}
          rows={5}
          disabled={phase === "drafting"}
          placeholder="e.g. I run a small law firm and need help preparing discovery documents, roughly 15 hours a week…"
          className="mt-6 w-full rounded-xl border border-text/15 bg-white p-4 text-[15px] leading-relaxed text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />

        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={phase === "drafting"}
              onClick={() => setBrief(ex)}
              className="rounded-full border border-text/10 bg-white px-3 py-1.5 text-xs text-text/60 hover:border-primary/40 hover:text-text transition-colors"
            >
              {ex.length > 60 ? ex.slice(0, 57) + "…" : ex}
            </button>
          ))}
        </div>

        <button
          onClick={() => requestDraft()}
          disabled={phase === "drafting" || brief.trim().length < 10}
          className="mt-8 w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
        >
          {phase === "drafting" ? DRAFTING_LINES[draftingLine] : "Draft my job post"}
        </button>
        {phase === "drafting" && (
          <div className="mt-6 space-y-3" aria-hidden>
            <div className="h-6 w-2/3 animate-pulse rounded bg-text/10" />
            <div className="h-4 w-full animate-pulse rounded bg-text/10" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-text/10" />
            <div className="h-4 w-4/6 animate-pulse rounded bg-text/10" />
          </div>
        )}
      </main>
    );
  }

  // ── Edit phase ───────────────────────────────────────────────────────────
  if (!draft) return null;

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text">Review your job post</h1>
          <p className="mt-1 text-sm text-text/60">Everything is editable — the draft is a starting point, not a verdict.</p>
        </div>
        <button
          onClick={() => setPhase("brief")}
          className="text-sm text-text/60 underline hover:text-text"
        >
          Start over with a new brief
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {draft.follow_up_question && (
        <div className="mb-6 rounded-xl border border-primary/25 bg-primary/5 p-4">
          <p className="text-sm font-medium text-text">{draft.follow_up_question}</p>
          <div className="mt-3 flex gap-2">
            <input
              value={followUpAnswer}
              onChange={(e) => setFollowUpAnswer(e.target.value)}
              maxLength={300}
              placeholder="Type a quick answer (optional)"
              className="flex-1 rounded-lg border border-text/15 px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button
              onClick={() => followUpAnswer.trim() && requestDraft("Incorporate the client's additional detail.", followUpAnswer.trim())}
              disabled={!followUpAnswer.trim() || !!rewriting}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Update draft
            </button>
            <button
              onClick={() => update("follow_up_question", null)}
              className="rounded-lg border border-text/15 px-3 py-2 text-sm text-text/60"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        {/* ── The post ── */}
        <div className="rounded-2xl border border-text/10 bg-white p-8">
          <input
            value={draft.title}
            onChange={(e) => update("title", e.target.value.slice(0, 90))}
            className="w-full border-none bg-transparent text-2xl font-bold text-text outline-none focus:ring-0"
            aria-label="Job title"
          />
          <p className="mt-1 text-sm text-text/50">
            {draft.role_category} · {draft.hours_per_week_estimate} · {draft.duration_estimate}
          </p>

          <div className="mt-6">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-text/50">About the role</h3>
              <div className="flex gap-2">
                {["Shorter", "Friendlier", "More specific"].map((how) => (
                  <button
                    key={how}
                    onClick={() => requestDraft(`Rewrite the summary to be ${how.toLowerCase()}. Keep everything else unchanged.`)}
                    disabled={!!rewriting}
                    className="rounded-full border border-text/10 px-2.5 py-1 text-[11px] text-text/60 hover:border-primary/40 hover:text-primary disabled:opacity-40"
                  >
                    {rewriting?.includes(how.toLowerCase()) ? "…" : how}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              value={draft.summary}
              onChange={(e) => update("summary", e.target.value.slice(0, 600))}
              rows={5}
              className="w-full resize-none rounded-lg border border-transparent bg-transparent p-2 -m-2 text-[15px] leading-relaxed text-text/90 outline-none hover:border-text/10 focus:border-primary/40"
            />
          </div>

          <div className="mt-6">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text/50">What you&apos;ll do</h3>
            <ul className="space-y-2">
              {draft.responsibilities.map((r, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-[9px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />
                  <input
                    value={r}
                    onChange={(e) => {
                      const next = [...draft.responsibilities];
                      next[i] = e.target.value.slice(0, 120);
                      update("responsibilities", next);
                    }}
                    className="w-full border-none bg-transparent text-[15px] text-text/90 outline-none"
                  />
                  <button
                    onClick={() => update("responsibilities", draft.responsibilities.filter((_, j) => j !== i))}
                    className="text-text/30 hover:text-red-500"
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            {draft.responsibilities.length < 6 && (
              <button
                onClick={() => update("responsibilities", [...draft.responsibilities, ""])}
                className="mt-2 text-sm text-primary hover:underline"
              >
                + Add a task
              </button>
            )}
          </div>

          <div className="mt-6">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text/50">Skills</h3>
            <div className="flex flex-wrap gap-2">
              {draft.must_have_skills.map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  {s}
                  <button onClick={() => update("must_have_skills", draft.must_have_skills.filter((x) => x !== s))} aria-label={`Remove ${s}`}>×</button>
                </span>
              ))}
              {draft.nice_to_have_skills.map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5 rounded-full border border-text/15 px-3 py-1 text-xs text-text/60">
                  {s} <span className="text-text/35">nice-to-have</span>
                  <button onClick={() => update("nice_to_have_skills", draft.nice_to_have_skills.filter((x) => x !== s))} aria-label={`Remove ${s}`}>×</button>
                </span>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={newSkill}
                onChange={(e) => setNewSkill(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addSkill("must_have_skills", newSkill)}
                placeholder="Add a skill…"
                maxLength={40}
                className="w-44 rounded-lg border border-text/15 px-3 py-1.5 text-xs outline-none focus:border-primary"
              />
              <button onClick={() => addSkill("must_have_skills", newSkill)} className="rounded-lg border border-text/15 px-3 py-1.5 text-xs text-text/60 hover:border-primary/40">Add</button>
            </div>
            {roleSkillSuggestions.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-text/40">Common for this role:</span>
                {roleSkillSuggestions.slice(0, 5).map((s) => (
                  <button key={s} onClick={() => addSkill("must_have_skills", s)} className="rounded-full border border-dashed border-text/20 px-2.5 py-0.5 text-[11px] text-text/50 hover:border-primary/50 hover:text-primary">
                    + {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── The controls ── */}
        <aside className="space-y-5 self-start rounded-2xl border border-text/10 bg-white p-6">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text/50">Role category</label>
            <select
              value={draft.role_category}
              onChange={(e) => update("role_category", e.target.value)}
              className="w-full rounded-lg border border-text/15 bg-white px-3 py-2 text-sm outline-none focus:border-primary"
            >
              {ALL_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text/50">Hours per week</label>
            <div className="grid grid-cols-2 gap-2">
              {HOURS_BUCKETS.map((h) => (
                <button
                  key={h}
                  onClick={() => update("hours_per_week_estimate", h)}
                  className={`rounded-lg border px-2 py-2 text-xs transition-colors ${draft.hours_per_week_estimate === h ? "border-primary bg-primary/5 font-semibold text-primary" : "border-text/15 text-text/70 hover:border-text/30"}`}
                >
                  {h}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text/50">Duration</label>
            <div className="flex gap-2">
              {(["ongoing", "project"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => update("duration_type", t)}
                  className={`flex-1 rounded-lg border px-2 py-2 text-xs capitalize transition-colors ${draft.duration_type === t ? "border-primary bg-primary/5 font-semibold text-primary" : "border-text/15 text-text/70 hover:border-text/30"}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <input
              value={draft.duration_estimate}
              onChange={(e) => update("duration_estimate", e.target.value.slice(0, 60))}
              placeholder={draft.duration_type === "ongoing" ? "Ongoing" : "e.g. About 3 months"}
              className="mt-2 w-full rounded-lg border border-text/15 px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text/50">Experience level</label>
            <div className="grid grid-cols-2 gap-2">
              {LEVELS.map((l) => (
                <button
                  key={l.value}
                  onClick={() => update("experience_level", l.value)}
                  className={`rounded-lg border px-2 py-2 text-xs transition-colors ${draft.experience_level === l.value ? "border-primary bg-primary/5 font-semibold text-primary" : "border-text/15 text-text/70 hover:border-text/30"}`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text/50">Pay</label>
            <div className="flex gap-2">
              {(["hourly", "fixed"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => update("rate_type", t)}
                  className={`flex-1 rounded-lg border px-2 py-2 text-xs capitalize transition-colors ${draft.rate_type === t ? "border-primary bg-primary/5 font-semibold text-primary" : "border-text/15 text-text/70 hover:border-text/30"}`}
                >
                  {t === "hourly" ? "Hourly range" : "Fixed budget"}
                </button>
              ))}
            </div>
            {draft.rate_type === "hourly" ? (
              <div className="mt-2 flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text/40">$</span>
                  <input
                    type="number" min={3} max={500}
                    value={draft.hourly_rate_min ?? ""}
                    onChange={(e) => update("hourly_rate_min", e.target.value ? Number(e.target.value) : null)}
                    className="w-full rounded-lg border border-text/15 py-2 pl-7 pr-2 text-sm outline-none focus:border-primary"
                    aria-label="Minimum hourly rate"
                  />
                </div>
                <span className="text-text/40">–</span>
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text/40">$</span>
                  <input
                    type="number" min={3} max={500}
                    value={draft.hourly_rate_max ?? ""}
                    onChange={(e) => update("hourly_rate_max", e.target.value ? Number(e.target.value) : null)}
                    className="w-full rounded-lg border border-text/15 py-2 pl-7 pr-2 text-sm outline-none focus:border-primary"
                    aria-label="Maximum hourly rate"
                  />
                </div>
                <span className="text-sm text-text/40">/hr</span>
              </div>
            ) : (
              <div className="relative mt-2">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text/40">$</span>
                <input
                  type="number" min={1} max={100000}
                  value={draft.fixed_budget ?? ""}
                  onChange={(e) => update("fixed_budget", e.target.value ? Number(e.target.value) : null)}
                  placeholder="Total project budget"
                  className="w-full rounded-lg border border-text/15 py-2 pl-7 pr-2 text-sm outline-none focus:border-primary"
                  aria-label="Fixed project budget"
                />
              </div>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text/50">Start</label>
            <div className="grid grid-cols-3 gap-2">
              {["Immediately", "Within 2 weeks", "Within a month"].map((sd) => (
                <button
                  key={sd}
                  onClick={() => setStartDate(sd)}
                  className={`rounded-lg border px-1 py-2 text-[11px] transition-colors ${startDate === sd ? "border-primary bg-primary/5 font-semibold text-primary" : "border-text/15 text-text/70 hover:border-text/30"}`}
                >
                  {sd}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={publish}
            disabled={phase === "publishing" || !draft.title.trim()}
            className="w-full rounded-full bg-primary py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
          >
            {phase === "publishing" ? "Publishing…" : "Publish and see matches"}
          </button>
          <p className="text-center text-[11px] leading-relaxed text-text/40">
            Only candidates who match the role or its must-have skills will see this posting.
          </p>
        </aside>
      </div>
    </main>
  );
}
