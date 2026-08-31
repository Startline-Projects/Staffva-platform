/**
 * Pre-hire contact masking. The messages route already refuses whole
 * messages containing contact info; these helpers cover the surfaces where
 * refusal isn't possible — free text the candidate wrote long ago (bio,
 * tagline, work history) rendered to clients, and job-post text written by
 * clients for candidates.
 *
 * Deliberately NARROWER than the message blocker: it masks contact DATA
 * (emails, phone numbers, URLs, handles, "telegram: @user"), never bare
 * platform names — "managed the company's WhatsApp support line" is a work
 * history, not a leak. Server-side only (uses lookbehind; also the raw
 * text must never reach the browser for a masked viewer).
 */

const MASK = "•••";

const URL_RE =
  /(?:https?:\/\/|www\.)[^\s,;)]+|(?:linkedin\.com|facebook\.com|fb\.com|instagram\.com|t\.me|wa\.me|x\.com|twitter\.com|tiktok\.com|discord\.gg|calendly\.com)\/[^\s,;)]*/gi;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// "whatsapp: +63 917...", "telegram @handle", "skype - user.name". The id
// token must LOOK like an id in BOTH branches — carry a digit, @, #, or an
// interior dot — so "WhatsApp - answered customer queries" and
// "Instagram-focused campaigns" stay untouched. (# covers discord tags.)
const PLATFORM_ID_RE =
  /\b(?:whatsapp|telegram|skype|viber|signal|discord|wechat|instagram|ig)\b(?:\s*[:#-]\s*(?=[\w+@#-]*(?:[\d@#]|\.\w))|\s+(?=[@+]|\S*\d))[\w+.@#-]{5,}/gi;
const HANDLE_RE = /(?<=^|[\s(,;:])@[a-zA-Z0-9._]{2,30}\b/g;
// Digit runs with separators; the callback keeps short runs and year ranges.
const PHONE_RE = /\+?\d[\d\s().-]{6,18}\d/g;

export function maskContact(text: string): string {
  return text
    .replace(URL_RE, MASK)
    .replace(EMAIL_RE, MASK)
    .replace(PLATFORM_ID_RE, MASK)
    .replace(PHONE_RE, (m) => {
      const digits = m.replace(/\D/g, "");
      if (digits.length < 8) return m; // "$3-40", short numbers
      if (/^\s*\d{4}\s*[-–—]\s*\d{4}\s*$/.test(m)) return m; // "2019 - 2023"
      if (/^(?:\d{2}-\d{2}-(?:19|20)\d{2}|(?:19|20)\d{2}-\d{2}-\d{2})$/.test(m.trim())) return m; // dates
      return MASK;
    })
    .replace(HANDLE_RE, MASK);
}

export function containsContact(text: string): boolean {
  return maskContact(text) !== text;
}

interface WorkExperienceEntry {
  company_name?: string;
  description?: string;
  [key: string]: unknown;
}

/**
 * Masks the free-text fields of a candidate row for a client-facing view.
 * Returns the same object shape; untouched fields pass through.
 */
export function maskCandidateText<
  T extends {
    bio?: string | null;
    tagline?: string | null;
    work_experience?: unknown;
    ai_insight_1?: string | null;
    ai_insight_2?: string | null;
  },
>(candidate: T): T {
  return {
    ...candidate,
    bio: typeof candidate.bio === "string" ? maskContact(candidate.bio) : candidate.bio,
    tagline: typeof candidate.tagline === "string" ? maskContact(candidate.tagline) : candidate.tagline,
    // Model-written from the raw bio, so they can echo what the view hides.
    ai_insight_1:
      typeof candidate.ai_insight_1 === "string" ? maskContact(candidate.ai_insight_1) : candidate.ai_insight_1,
    ai_insight_2:
      typeof candidate.ai_insight_2 === "string" ? maskContact(candidate.ai_insight_2) : candidate.ai_insight_2,
    work_experience: Array.isArray(candidate.work_experience)
      ? (candidate.work_experience as WorkExperienceEntry[]).map((w) =>
          w && typeof w === "object"
            ? {
                ...w,
                company_name:
                  typeof w.company_name === "string" ? maskContact(w.company_name) : w.company_name,
                description:
                  typeof w.description === "string" ? maskContact(w.description) : w.description,
              }
            : w
        )
      : candidate.work_experience,
  };
}
