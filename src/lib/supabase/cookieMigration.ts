import type { NextRequest, NextResponse } from "next/server";
import { cookieDomainForHost, hostnameOf, PRIMARY_HOST } from "./cookieDomain";

/**
 * Move existing sessions from host-only cookies onto the shared
 * `.staffva.com` scope, exactly once per browser.
 *
 * THE PROBLEM THIS SOLVES, because it is not obvious and it bites silently:
 * every session that exists today was written without a Domain attribute, so
 * it is host-only to staffva.com. Simply configuring the clients to write the
 * wider scope from now on does NOT convert them — it creates a SECOND cookie
 * with the SAME NAME at a different scope. Both are then sent on every request
 * to staffva.com, in an order the spec does not usefully pin down, and the
 * server takes whichever it parses first. The moment a token refresh updates
 * only the shared copy, the stale host-only twin can shadow it, and the
 * candidate is silently signed out mid-assessment.
 *
 * A server cannot tell the two apart on the way in — the Cookie header carries
 * names and values, never scopes. So this does not try to detect the state; it
 * rewrites unconditionally on the first request and records that it did with a
 * marker cookie set at the shared scope.
 *
 * ORDER MATTERS. The expiry of the host-only twin must be emitted BEFORE the
 * shared cookie is written, so a browser applying them in order never ends up
 * deleting the copy we just set.
 *
 * SAFETY: values are copied verbatim, so the session survives the move. If the
 * response is lost — the tab closes, the network drops — nothing has been
 * destroyed on the server and the next request simply tries again. The only
 * cookies touched are Supabase's own `sb-*`.
 */

/** Supabase's SSR cookies are all `sb-<project-ref>-auth-token`, sometimes
 *  chunked with a `.0`/`.1` suffix. Matching the prefix covers every chunk
 *  without this file having to know the project ref or the chunking scheme. */
const SUPABASE_COOKIE_PREFIX = "sb-";

/** Set at the shared scope, so its presence proves the shared scope works. */
export const COOKIE_SCOPE_MARKER = "sva-cookie-scope";

/** One year. Long enough that no live browser repeats the migration. */
const MARKER_MAX_AGE = 60 * 60 * 24 * 365;

function serializeCookie(
  name: string,
  value: string,
  opts: { domain?: string; maxAge?: number; expires?: string }
): string {
  const parts = [`${name}=${value}`, "Path=/", "SameSite=Lax", "Secure"];
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.expires) parts.push(`Expires=${opts.expires}`);
  return parts.join("; ");
}

/**
 * Returns true when it emitted a migration (for logging/tests).
 *
 * Deliberately writes raw `set-cookie` headers with `headers.append` rather
 * than `response.cookies.set`. Next's cookie helper keys its map by name, so
 * setting and deleting the same name in one response collapses into a single
 * entry — which is precisely the two-scope operation this needs to express.
 */
export function migrateSessionCookieScope(
  request: NextRequest,
  response: NextResponse
): boolean {
  const host = request.headers.get("host");
  const domain = cookieDomainForHost(host);

  // Not a staffva.com host (localhost, a preview deployment): host-only
  // cookies are correct there and must be left exactly as they are.
  if (!domain) return false;

  // ONLY on the primary host, and the reason is subtle enough to be worth
  // spelling out. Host-only session cookies can exist in exactly one place —
  // staffva.com, where they were written. But the marker is set at the SHARED
  // scope, so it is visible everywhere. Run this on englishtest.staffva.com
  // and a candidate who opens the test host first gets the marker planted
  // while none of their (host-only, staffva.com) auth cookies were even sent
  // — and the real migration is then skipped for ever, leaving them the
  // double-cookie state this whole file exists to prevent.
  if (hostnameOf(host) !== PRIMARY_HOST) return false;

  if (request.cookies.has(COOKIE_SCOPE_MARKER)) return false;

  const authCookies = request.cookies
    .getAll()
    .filter((c) => c.name.startsWith(SUPABASE_COOKIE_PREFIX));

  for (const cookie of authCookies) {
    // 1. Expire the host-only twin. No Domain attribute means this targets
    //    the host-only cookie specifically and leaves any shared one alone.
    response.headers.append(
      "set-cookie",
      serializeCookie(cookie.name, "", {
        maxAge: 0,
        expires: "Thu, 01 Jan 1970 00:00:00 GMT",
      })
    );
    // 2. Re-issue the same session at the shared scope. Same value, so the
    //    candidate stays signed in and MFA-satisfied across the move.
    response.headers.append(
      "set-cookie",
      serializeCookie(cookie.name, cookie.value, {
        domain,
        maxAge: MARKER_MAX_AGE,
      })
    );
  }

  // Written even when there were no auth cookies to move: a signed-out
  // visitor should not re-run this on every page view either, and when they
  // do sign in the clients already write the shared scope.
  response.headers.append(
    "set-cookie",
    serializeCookie(COOKIE_SCOPE_MARKER, "1", { domain, maxAge: MARKER_MAX_AGE })
  );

  return authCookies.length > 0;
}
