/**
 * How complete is this profile?
 *
 * A COUNT, not a score. Atlas shows a weighted 0-100 "Profile Strength" with
 * tiers at 40 and 70 — a photo is 12 points, a bio over 200 characters is 14,
 * three portfolio samples is 12 — and that number does not ship here. Three
 * reasons, in order of how much they matter:
 *
 * 1. Nothing ranks on it. get_candidates_with_skills orders by hourly_rate,
 *    total_earnings_usd, english_percentile or created_at. A 95 and a 41 sit in
 *    identical positions in front of a client. Showing someone a number that
 *    changes nothing, and calling it "Strong", is a motivational fiction.
 * 2. There is already a score, and it disagrees. reputation_score is weighted
 *    0-100 with tiers at 60/70/80/90, badges as Elite or Top Rated, and is fed
 *    verbatim to the model that writes client-facing copy. A candidate reading
 *    "Strong · 72" on their dashboard while their public card shows no tier at
 *    all has two numbers and no way to reconcile them.
 * 3. The English test is the precedent. A hidden weighted rubric that decides
 *    who gets seen must be inspectable by the person it scores; one that
 *    decides nothing should not be dressed up as a score at all.
 *
 * So: named sections, each done or not, each linking to where to fix it. If the
 * owner wants a ring, it fills to the fraction of this list that is complete —
 * derived here, persisted nowhere, and read by nothing that decides visibility
 * or promotion.
 */

export interface CompletenessInput {
  profile_photo_url?: string | null;
  display_name?: string | null;
  city?: string | null;
  country?: string | null;
  role_title?: string | null;
  tagline?: string | null;
  bio?: string | null;
  hourly_rate?: number | null;
  hours_per_week?: number | null;
  payout_method?: string | null;
  skills?: unknown;
  tools?: unknown;
  work_experience?: unknown;
  resume_url?: string | null;
  video_intro_url?: string | null;
  voice_recording_2_url?: string | null;
}

export interface CompletenessSection {
  key: string;
  /** What the candidate calls it. */
  label: string;
  done: boolean;
  /** Which builder step or page fixes it. */
  step: string;
  /** Shown when it is not done — says what is actually missing. */
  missing?: string;
  /** False for the ones a candidate can finish later without being blocked. */
  required: boolean;
  /** True when this section is collected somewhere OTHER than the builder —
   *  the voice and video recorders live on their own pages. The review step
   *  must not tell someone these are stopping them from submitting a form
   *  that could never have captured them. */
  elsewhere?: boolean;
}

function len(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function profileSections(c: CompletenessInput): CompletenessSection[] {
  const bio = text(c.bio);
  const skills = len(c.skills);
  const tools = len(c.tools);
  const jobs = len(c.work_experience);

  return [
    {
      key: "photo",
      label: "Profile photo",
      done: !!c.profile_photo_url,
      step: "A",
      missing: "Clients see this first — a clear headshot, looking at the camera.",
      required: true,
    },
    {
      key: "basics",
      label: "Name, location and title",
      done: !!text(c.display_name) && !!text(c.country) && !!text(c.role_title),
      step: "A",
      missing: !text(c.role_title)
        ? "Add the job title you'd want a client to see."
        : "Add where you're based.",
      required: true,
    },
    {
      key: "tagline",
      label: "Headline",
      done: text(c.tagline).length >= 20,
      step: "A",
      missing: "One line on what you do. Aim for 20 characters or more.",
      required: false,
    },
    {
      key: "bio",
      label: "About you",
      done: bio.length >= 200,
      step: "B",
      missing:
        bio.length === 0
          ? "Nothing written yet."
          : `${bio.length} characters so far — 200 is where it starts reading as a real profile.`,
      required: true,
    },
    {
      key: "rate",
      label: "Rate and availability",
      done: !!c.hourly_rate && c.hourly_rate > 0 && !!c.hours_per_week,
      step: "C",
      missing: !c.hourly_rate
        ? "Set your hourly rate."
        : "Say how many hours a week you want to work.",
      required: true,
    },
    {
      key: "skills",
      label: "Skills and tools",
      done: skills >= 5 && tools >= 3,
      step: "D",
      missing: `${skills} skill${skills === 1 ? "" : "s"} and ${tools} tool${
        tools === 1 ? "" : "s"
      } — aim for 5 and 3.`,
      required: true,
    },
    {
      key: "work",
      label: "Work history",
      done: jobs >= 1,
      step: "E",
      missing: "Add at least one previous role.",
      required: true,
    },
    {
      key: "resume",
      label: "Résumé",
      done: !!c.resume_url,
      step: "F",
      missing: "Upload a PDF.",
      required: true,
    },
    {
      key: "payout",
      label: "How you get paid",
      done: !!c.payout_method,
      step: "C",
      missing: "Choose a payout method.",
      required: true,
    },
    {
      key: "voice",
      label: "Voice introduction",
      done: !!c.voice_recording_2_url,
      step: "record",
      missing: "About a minute, recorded in your browser.",
      required: true,
      elsewhere: true,
    },
    {
      key: "video",
      label: "Video introduction",
      done: !!c.video_intro_url,
      step: "record",
      missing: "About 75 seconds, four short prompts.",
      required: false,
      elsewhere: true,
    },
  ];
}

export interface Completeness {
  sections: CompletenessSection[];
  done: number;
  total: number;
  /** Only the required ones — this is what "can I submit?" means. */
  requiredDone: number;
  requiredTotal: number;
  ready: boolean;
  /** Required, still missing, and captured INSIDE the builder — the only ones
   *  that honestly stand between the candidate and pressing Submit. */
  blockingHere: number;
  /** 0-100, for a progress ring. Derived, never stored, never read by a gate. */
  percent: number;
}

export function profileCompleteness(c: CompletenessInput): Completeness {
  const sections = profileSections(c);
  const done = sections.filter((s) => s.done).length;
  const required = sections.filter((s) => s.required);
  const requiredDone = required.filter((s) => s.done).length;
  return {
    sections,
    done,
    total: sections.length,
    requiredDone,
    requiredTotal: required.length,
    ready: requiredDone === required.length,
    blockingHere: required.filter((s) => !s.done && !s.elsewhere).length,
    percent: Math.round((done / sections.length) * 100),
  };
}
