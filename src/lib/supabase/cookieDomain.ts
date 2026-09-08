/**
 * Which cookie scope a request's session should be written at.
 *
 * The English assessment now lives on its own host, englishtest.staffva.com,
 * served by this same deployment. A candidate signs in on staffva.com and has
 * to arrive there already signed in — and still MFA-satisfied, because the
 * assessment is proctored and paid for. Cookies are host-only by default, so
 * without this the session simply does not travel and the test host sees a
 * logged-out stranger.
 *
 * Only staffva.com and its subdomains get the shared scope. Everything else —
 * localhost, Vercel preview URLs, anything unexpected — keeps host-only
 * cookies, which is both correct and the safe default: a preview deployment
 * must never be able to write a cookie that the production domain would send.
 *
 * A NOTE ON BLAST RADIUS, since widening a session cookie deserves one: the
 * shared scope means the session token is sent to every *.staffva.com host,
 * interview.staffva.com included. That app does not read Supabase auth
 * cookies — it authenticates with its own signed token — so nothing there
 * consumes it, but the exposure is real and any future subdomain inherits it.
 * The flags are unchanged; only the scope widened.
 */
export const SHARED_COOKIE_DOMAIN = ".staffva.com";

/** The host the English assessment is served from. */
export const ENGLISH_TEST_HOST = "englishtest.staffva.com";

/** The canonical host for everything else. */
export const PRIMARY_HOST = "staffva.com";

/** Strip the port and normalise. Host headers carry ":3000" locally. */
export function hostnameOf(host: string | null | undefined): string {
  if (!host) return "";
  return host.split(":")[0].trim().toLowerCase();
}

/**
 * The `domain` to write session cookies with, or undefined for host-only.
 *
 * Returning undefined is not a failure mode — it is the correct answer for
 * every host that is not staffva.com.
 */
export function cookieDomainForHost(host: string | null | undefined): string | undefined {
  const hostname = hostnameOf(host);
  if (!hostname) return undefined;
  if (hostname === PRIMARY_HOST) return SHARED_COOKIE_DOMAIN;
  if (hostname.endsWith(`.${PRIMARY_HOST}`)) return SHARED_COOKIE_DOMAIN;
  return undefined;
}

export function isEnglishTestHost(host: string | null | undefined): boolean {
  return hostnameOf(host) === ENGLISH_TEST_HOST;
}
