import { NextResponse, type NextRequest } from "next/server";
import { ENGLISH_TEST_HOST, PRIMARY_HOST, isEnglishTestHost } from "@/lib/supabase/cookieDomain";

/**
 * englishtest.staffva.com — the English assessment's own address.
 *
 * It is the SAME deployment as staffva.com, not a second app. That is a
 * deliberate choice: the assessment is paid for now, and its payment gate,
 * entitlement claim, grading and refund logic all live here. Forking those
 * into a second codebase to gain a hostname would duplicate exactly the code
 * where money bugs breed — the same duplication that produced the mid-test
 * paywall this feature had to be rebuilt to fix.
 *
 * So the split is a routing concern:
 *   * On englishtest.staffva.com the root IS the assessment. `/` rewrites to
 *     /assessment, so the candidate's address bar reads the test's own host
 *     for the whole sitting rather than flashing a redirect to staffva.com.
 *   * The paths the sitting genuinely needs — the assessment page, its API
 *     routes, auth, Next's own assets — are served there.
 *   * Everything else is sent to staffva.com. The test host is not a second
 *     front door to the marketplace; a candidate who lands there looking for
 *     their dashboard should end up on the real one, not a half-working copy
 *     with the wrong canonical URL.
 */

/** Path prefixes the assessment host serves itself. Everything else leaves. */
const ENGLISH_TEST_PATHS = [
  "/assessment",
  // The test's own API surface. /api/test deals and grades the attempt;
  // /api/proctor takes the anti-cheat events; /api/assessments is the
  // purchase. Without these the page loads and then cannot do anything.
  "/api/test",
  "/api/proctor",
  "/api/assessments",
  // Auth has to work here or a signed-out arrival can never get in.
  "/api/auth",
  "/auth",
  "/login",
  "/logout",
  // Framework and static assets.
  "/_next",
  "/favicon.ico",
];

function servedHere(pathname: string): boolean {
  return ENGLISH_TEST_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

/**
 * Host-level routing, applied before anything else in the middleware.
 *
 * Returns a response when the request belongs somewhere other than where it
 * arrived, or null to let the normal pipeline handle it.
 */
export function routeByHost(request: NextRequest): NextResponse | null {
  const host = request.headers.get("host");
  const { pathname, search } = request.nextUrl;

  if (isEnglishTestHost(host)) {
    // The root of this host is the test itself. A REWRITE, not a redirect:
    // a redirect would bounce the candidate to /assessment and the address
    // bar would stop saying englishtest.staffva.com, which is the entire
    // point of giving the test its own host.
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/assessment";
      return NextResponse.rewrite(url);
    }

    if (servedHere(pathname)) return null;

    // Anything else belongs on the marketplace. 307 preserves the method, so
    // a form post that somehow lands here is not silently downgraded to GET.
    return NextResponse.redirect(
      new URL(`https://${PRIMARY_HOST}${pathname}${search}`),
      307
    );
  }

  return null;
}

/**
 * Where to send a candidate to sit the English assessment.
 *
 * One helper rather than a literal at each call site: the dashboard, the
 * pipeline CTA and the paywall screen must all agree, and a link left
 * pointing at /assessment on the main host would silently keep working —
 * which is worse than breaking, because nobody would notice the test host had
 * stopped being used.
 *
 * Falls back to the relative path when the assessment host is not configured,
 * so local development and preview deployments keep working unchanged.
 */
export function englishTestUrl(path = ""): string {
  if (process.env.NEXT_PUBLIC_ENGLISH_TEST_URL) {
    return `${process.env.NEXT_PUBLIC_ENGLISH_TEST_URL}${path}`;
  }
  if (process.env.NODE_ENV !== "production") return `/assessment${path}`;
  return `https://${ENGLISH_TEST_HOST}${path}`;
}
