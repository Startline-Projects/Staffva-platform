import { NextResponse, type NextRequest } from "next/server";
import { PRIMARY_HOST, isEnglishTestHost } from "@/lib/supabase/cookieDomain";

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
  //
  // These four are BELT AND BRACES, not the reason API calls work: the
  // middleware matcher in src/middleware.ts excludes /api/ outright, so
  // routeByHost never sees an API request and none is ever redirected away.
  // They are listed so that if the matcher is ever widened, the test host does
  // not start 307ing its own fetches to staffva.com — which would fail as
  // cross-origin and break a sitting in progress.
  "/api/test",
  "/api/proctor",
  "/api/assessments",
  // Auth has to work here or a signed-out arrival can never get in.
  "/api/auth",
  "/auth",
  "/login",
  "/logout",
  // Framework and static assets. /_next is likewise matcher-excluded for
  // /_next/static and /_next/image; the prefix also covers the RSC and
  // build-manifest routes that are not.
  "/_next",
  "/favicon.ico",
];

function servedHere(pathname: string): boolean {
  return ENGLISH_TEST_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

/**
 * What host routing decided about this request.
 *
 * A rewrite is returned as a URL rather than a finished response, and that is
 * load-bearing. A middleware rewrite does NOT re-enter middleware — Next runs
 * the proxy step once, then filesystem routes — so returning the rewrite
 * immediately would skip every guard that follows it: the session lookup, the
 * MFA-pending redirect, the protected-route check, the US-experience gate.
 * The assessment page does not re-implement those (it checks only role), so
 * the root of the test host would have been the one URL in the product where
 * an aal1 session that owes aal2 is not challenged.
 *
 * Handing back the URL instead lets the caller run every guard against the
 * REWRITTEN pathname and only then emit the rewrite.
 */
export type HostRoute =
  | { kind: "redirect"; response: NextResponse }
  | { kind: "rewrite"; url: URL }
  | null;

export function routeByHost(request: NextRequest): HostRoute {
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
      return { kind: "rewrite", url };
    }

    if (servedHere(pathname)) return null;

    // Anything else belongs on the marketplace. 307 preserves the method, so
    // a form post that somehow lands here is not silently downgraded to GET.
    // Safe to return finished: a redirect runs no page and needs no guard —
    // staffva.com will apply its own when the browser arrives there.
    return {
      kind: "redirect",
      response: NextResponse.redirect(
        new URL(`https://${PRIMARY_HOST}${pathname}${search}`),
        307
      ),
    };
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
 * OPT-IN, and deliberately so. This returns the relative /assessment path
 * until NEXT_PUBLIC_ENGLISH_TEST_URL is set, because code and DNS ship on
 * different clocks: this deployment can land before englishtest.staffva.com
 * has a domain on the project or a DNS record, and hard-coding the host for
 * production would point every candidate's "Start your English assessment"
 * button at a name that does not resolve. The failure would be total and
 * would arrive at the exact moment the deploy went out.
 *
 * routeByHost above is already live either way — it costs nothing until
 * requests actually arrive on that host — so the switch-over is one
 * environment variable, not a code change. Note it is NEXT_PUBLIC_, which
 * Next inlines at build time, so setting it needs a redeploy to take effect.
 */
export function englishTestUrl(path = ""): string {
  if (process.env.NEXT_PUBLIC_ENGLISH_TEST_URL) {
    return `${process.env.NEXT_PUBLIC_ENGLISH_TEST_URL}${path}`;
  }
  return `/assessment${path}`;
}
