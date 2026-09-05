/**
 * A display name that cannot be a contact channel.
 *
 * company_name and full_name are free text typed at signup (company_name via
 * the unauthenticated ensure-profile route). The messaging review showed
 * "Acme — WhatsApp +63 917 555 0100" as a company name sailing past the
 * contact-info filter that blocks the identical string in a message body —
 * rendered in the thread list and conversation header before any contract
 * exists. Same patterns as the body filter; a name that trips them degrades
 * to the next candidate, and finally to the honest generic.
 */

const CONTACT_PATTERNS = [
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i, // email
  /\+?\d{7,}/, // long digit runs (phone with or without separators stripped below)
  /(?:instagram|ig)\s*[:\-@]\s*\S+/i,
  /@[a-zA-Z0-9._]{2,30}/,
  /whatsapp/i,
  /linkedin\.com/i,
  /facebook\.com|fb\.com/i,
  /t\.me\//i,
  /twitter\.com|x\.com/i,
  /discord/i,
  /skype/i,
  /viber/i,
  /signal/i,
  /https?:\/\//i,
];

function looksLikeContactChannel(name: string): boolean {
  const collapsed = name.replace(/[\s.\-()]/g, "");
  return CONTACT_PATTERNS.some((p) => p.test(name) || p.test(collapsed));
}

/** Company first, person second, generic last — never a contact channel. */
export function contactSafeClientName(
  companyName: string | null | undefined,
  fullName: string | null | undefined
): string {
  for (const candidate of [companyName, fullName]) {
    const trimmed = candidate?.trim();
    if (trimmed && !looksLikeContactChannel(trimmed)) return trimmed;
  }
  return "A client";
}

/**
 * The contact person's first name, or null when the field (or the token
 * itself) reads as a contact channel. "hireme@gmail.com" is its own first
 * token; "+639175550100 Juan" hides the payload IN the token — both must
 * die here, because this renders on the pre-contract trust page.
 */
export function contactSafeFirstName(fullName: string | null | undefined): string | null {
  const trimmed = fullName?.trim();
  if (!trimmed || looksLikeContactChannel(trimmed)) return null;
  const token = trimmed.split(/\s+/)[0];
  if (!token || looksLikeContactChannel(token)) return null;
  return token;
}
