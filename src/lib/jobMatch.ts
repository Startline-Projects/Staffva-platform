import { englishTierBonus, englishTierLabel } from "@/lib/englishTier";
import { describeUsExperience, hasUsExperience } from "@/lib/usExperienceLabels";

/**
 * One scorer for "how well does this candidate fit this job post", returning
 * the score AND the reason for every point of it.
 *
 * Why one function: the score used to be computed inline at publish and shown
 * as a bare "87% match" with nothing behind it. A client could not tell
 * whether 87 meant "has every skill but costs too much" or "cheap but wrong
 * role" — and there was no way to check the number was even right. It wasn't:
 * MAX_MATCH_SCORE was hardcoded at 105 while the code awarded up to 113 (a
 * skills-interview bonus was added later and never added to the denominator).
 *
 * THE DENOMINATOR IS PER JOB, not a constant. It is the sum of the maxPoints
 * of the criteria actually emitted, so:
 *   - the rows always sum to exactly the headline score, and
 *   - a candidate is never marked down for skills the client never asked for.
 * A fixed denominator did both wrongs at once: a job with no listed skills
 * capped a flawless candidate at 71/100 under six green ticks, with nothing
 * on screen to reconcile it.
 *
 * There is deliberately NO cap on must-have points. The old cap zeroed the
 * per-skill rows once three matched and pushed one summary row to the end of
 * the list — where the page truncated it away, leaving five green ticks worth
 * 0/8 each beside a score they could not explain.
 *
 * Evidence strings say only what a column can support. Atlas's prototype
 * shows "QuickBooks · 5 yrs Expert"; we hold no per-skill seniority, so ours
 * says "Listed in their skills" and stops.
 */

export const WEIGHTS = {
  role: 40,
  mustHaveEach: 8,
  niceToHaveEach: 3,
  niceToHaveCap: 9,
  budget: 15,
  english: 8,
  interview: 8,
  usExperience: 5,
  availability: 4,
} as const;

export type Verdict = "met" | "partial" | "miss";

export interface MatchCriterion {
  key: string;
  label: string;
  verdict: Verdict;
  /** What in the data supports this verdict. Never a claim we can't source. */
  evidence: string;
  points: number;
  maxPoints: number;
}

export interface JobMatchResult {
  /** 0–100, and always exactly sum(points) / sum(maxPoints) of the rows below. */
  score: number;
  criteria: MatchCriterion[];
}

export interface MatchCandidate {
  role_category?: string | null;
  skills?: unknown;
  tools?: unknown;
  hourly_rate?: number | null;
  english_written_tier?: string | null;
  ai_interview_passed?: boolean | null;
  us_client_experience?: string | null;
  availability_status?: string | null;
  availability_date?: string | null;
}

export interface MatchJob {
  role_category?: string | null;
  must_have_skills?: unknown;
  nice_to_have_skills?: unknown;
  rate_type?: string | null;
  hourly_rate_min?: number | null;
  hourly_rate_max?: number | null;
}

const norm = (arr: unknown): string[] =>
  Array.isArray(arr) ? arr.map((x) => String(x).toLowerCase().trim()).filter(Boolean) : [];

const asList = (arr: unknown): string[] =>
  Array.isArray(arr) ? arr.map((x) => String(x).trim()).filter(Boolean) : [];

function verdictFor(points: number, max: number): Verdict {
  if (points >= max) return "met";
  return points > 0 ? "partial" : "miss";
}

export function scoreCandidateForJob(c: MatchCandidate, job: MatchJob): JobMatchResult {
  const criteria: MatchCriterion[] = [];

  // ── Role ────────────────────────────────────────────────────────────────
  // Exact match only — a near-miss scores zero rather than a fraction we'd
  // have to invent a rule for.
  //
  // One deliberate divergence: we compare TRIMMED, lowercased values, while
  // job_skill_or_role_match in 00192 compares with a bare lower() and no
  // btrim. So a candidate whose role is " VA" scores the role points here
  // though the SQL gate would not have credited it. That only ever applies to
  // someone already in the pool (they got there on a skill), and treating a
  // stray space as a mismatch would be the less truthful of the two.
  const jobRole = (job.role_category || "").trim();
  const candRole = (c.role_category || "").trim();
  const roleMet = !!jobRole && candRole.toLowerCase() === jobRole.toLowerCase();
  criteria.push({
    key: "role",
    label: "Role",
    verdict: roleMet ? "met" : "miss",
    evidence: !candRole
      ? "No role on their profile"
      : roleMet
        ? `${candRole} — the role you posted`
        : `${candRole} — you posted ${jobRole || "a different role"}`,
    points: roleMet ? WEIGHTS.role : 0,
    maxPoints: WEIGHTS.role,
  });

  // ── Must-have skills ────────────────────────────────────────────────────
  // Skills ONLY, deliberately: the visibility gate in 00192 reads skills and
  // not tools, and a score that credited "Slack" for a bookkeeping must-have
  // would rank someone the gate never qualified.
  // De-duplicated: a job listing the same skill twice would otherwise emit two
  // identical rows and double its weight in the denominator.
  const candSkills = new Set(norm(c.skills));
  const mustList = Array.from(new Set(asList(job.must_have_skills).map((s) => s.toLowerCase())))
    .map((lower) => asList(job.must_have_skills).find((s) => s.toLowerCase() === lower)!);
  for (const skill of mustList) {
    const hit = candSkills.has(skill.toLowerCase());
    criteria.push({
      key: `must:${skill}`,
      label: skill,
      verdict: hit ? "met" : "miss",
      evidence: hit ? "Listed in their skills" : "Not listed in their skills",
      points: hit ? WEIGHTS.mustHaveEach : 0,
      maxPoints: WEIGHTS.mustHaveEach,
    });
  }
  // ── Nice-to-have ────────────────────────────────────────────────────────
  // These MAY credit tools: a tie-breaker, not a qualification, and knowing a
  // client's stack is real.
  const candSkillsAndTools = new Set([...norm(c.skills), ...norm(c.tools)]);
  const niceList = asList(job.nice_to_have_skills);
  if (niceList.length > 0) {
    const hits = niceList.filter((s) => candSkillsAndTools.has(s.toLowerCase()));
    const nicePoints = Math.min(hits.length * WEIGHTS.niceToHaveEach, WEIGHTS.niceToHaveCap);
    // The ceiling is what THIS job's list can actually award, not the flat cap:
    // a post naming one nice-to-have would otherwise score a candidate who has
    // it at 3/9 and paint it as a partial miss.
    const niceMax = Math.min(niceList.length * WEIGHTS.niceToHaveEach, WEIGHTS.niceToHaveCap);
    criteria.push({
      key: "nice",
      label: "Nice to have",
      verdict: verdictFor(nicePoints, niceMax),
      evidence:
        hits.length === 0
          ? `None of ${niceList.length} listed`
          : `${hits.join(", ")} — ${hits.length} of ${niceList.length}`,
      points: nicePoints,
      maxPoints: niceMax,
    });
  }

  // ── Budget ──────────────────────────────────────────────────────────────
  // Emitted ONLY when it can actually be evaluated. A fixed-price post, a
  // post with no maximum, or a candidate with no rate used to take a
  // hardcoded 8-of-15 "partial" — points awarded for a check nobody ran,
  // which also made it impossible for a fixed-price post to score above 94.
  // Leaving the row out keeps it out of the denominator too, so an
  // uncheckable dimension neither credits nor penalises anyone.
  const rate = typeof c.hourly_rate === "number" ? c.hourly_rate : null;
  const max = typeof job.hourly_rate_max === "number" ? job.hourly_rate_max : null;
  const min = typeof job.hourly_rate_min === "number" ? job.hourly_rate_min : null;
  if (job.rate_type === "hourly" && rate !== null && max !== null) {
    const money = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
    let pts: number;
    let evidence: string;
    if (rate <= max) {
      pts = WEIGHTS.budget;
      // Under the minimum is still MET — it costs the client less, and hiding
      // affordable people would be the wrong way round. The sentence is
      // phrased so the green tick and the text agree; Atlas shows a bare
      // green tick here, which reads as a scoring bug.
      evidence =
        min !== null && rate < min
          ? `${money(rate)}/hr — under your ${money(min)} minimum, so within budget`
          : min !== null
            ? `${money(rate)}/hr — within your ${money(min)}–${money(max)} range`
            : `${money(rate)}/hr — at or under your ${money(max)} max`;
    } else if (rate <= max * 1.2) {
      pts = 8;
      evidence = `${money(rate)}/hr — ${money(Math.round((rate - max) * 100) / 100)} above your ${money(max)} max`;
    } else {
      pts = 0;
      evidence = `${money(rate)}/hr — well above your ${money(max)} max`;
    }
    criteria.push({
      key: "budget",
      label: "Budget",
      verdict: verdictFor(pts, WEIGHTS.budget),
      evidence,
      points: pts,
      maxPoints: WEIGHTS.budget,
    });
  }

  // ── English ─────────────────────────────────────────────────────────────
  const englishPts = englishTierBonus(c.english_written_tier ?? null, [8, 5, 3]);
  // A null tier is NOT "not assessed": assignWrittenTier returns null for any
  // percentile under 70, so it also covers "sat the test and scored below the
  // banding floor". The relist convention for that ambiguity is a dash.
  const tierLabel = englishTierLabel(c.english_written_tier ?? null);
  criteria.push({
    key: "english",
    label: "Written English",
    verdict: verdictFor(englishPts, WEIGHTS.english),
    evidence: tierLabel ?? "No tier on record",
    points: englishPts,
    maxPoints: WEIGHTS.english,
  });

  // ── Skills interview ────────────────────────────────────────────────────
  const passed = c.ai_interview_passed === true;
  criteria.push({
    key: "interview",
    label: "Skills interview",
    verdict: passed ? "met" : "miss",
    // false means "sat it and did not pass"; null means "no record". Saying
    // "not assessed yet" for both asserts a history the column cannot support,
    // about the fact a client is most likely to act on. CompareTray already
    // settled on this wording.
    evidence: passed ? "Passed StaffVA's skills interview" : "No pass on record",
    points: passed ? WEIGHTS.interview : 0,
    maxPoints: WEIGHTS.interview,
  });

  // ── US client experience ────────────────────────────────────────────────
  // Via the shared helper: the column is an enum whose "none" value is a
  // truthy string, so a naive check scored every candidate — and could award
  // the points to someone the badge on the same card refused.
  const us = hasUsExperience(c.us_client_experience ?? null);
  criteria.push({
    key: "us",
    label: "US client experience",
    verdict: us ? "met" : "miss",
    // hasUsExperience() requires a YEAR or more, so a candidate who recorded
    // "6 months to 1 year" scores zero here — and "None recorded" would
    // contradict the value on their own profile. The stored answer is shown
    // either way; only the points depend on the threshold.
    evidence: describeUsExperience(c.us_client_experience ?? null),
    points: us ? WEIGHTS.usExperience : 0,
    maxPoints: WEIGHTS.usExperience,
  });

  // ── Availability ────────────────────────────────────────────────────────
  const availNow = c.availability_status === "available_now";
  criteria.push({
    key: "availability",
    label: "Availability",
    verdict: availNow ? "met" : "miss",
    evidence: availNow
      ? "Available now"
      : c.availability_status === "available_by_date"
        ? c.availability_date
          ? `From ${new Date(c.availability_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
          : "Available from a date they haven't given"
        : c.availability_status === "not_available"
          ? "Not available"
          : "Not stated",
    points: availNow ? WEIGHTS.availability : 0,
    maxPoints: WEIGHTS.availability,
  });

  // The denominator is what THIS job could award, so the rows always
  // reconcile to the headline and an unlisted skill is not a deduction.
  const total = criteria.reduce((n, r) => n + r.points, 0);
  const available = criteria.reduce((n, r) => n + r.maxPoints, 0);
  return {
    score: available === 0 ? 0 : Math.max(0, Math.min(100, Math.round((total / available) * 100))),
    criteria,
  };
}
