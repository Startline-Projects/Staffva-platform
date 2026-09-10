import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { cookieDomainForHost } from "./cookieDomain";
import { migrateSessionCookieScope } from "./cookieMigration";
import { routeByHost } from "@/lib/englishTestHost";

// Routes that require authentication.
// "/verify" is the client twin of "/verify-id" and belongs here for the same
// reason the mfaPending branch spells out: without it, an MFA detour on the
// way back from Stripe drops ?id_check=returning, and the page it lands on
// never polls for the result.
const protectedRoutes = ["/apply", "/inbox", "/admin", "/team", "/hire", "/candidate/dashboard", "/verify", "/verify-id", "/verify-phone", "/assessment"];

/**
 * Match a route prefix on SEGMENT boundaries, not raw characters.
 *
 * `pathname.startsWith(route)` looked equivalent and was not. "/verify" in the
 * list above means the client twin of /verify-id — but as a bare prefix it
 * also swallowed /verify-email, and that page has to be reachable by
 * someone with no session, because the sign-in flow deliberately signs them
 * out before sending them there:
 *
 *   login → email_verified is false → supabase.auth.signOut()
 *         → router.push("/verify-email")
 *         → middleware sees a protected route and no user
 *         → redirect to /login
 *
 * A closed loop. Every account with an unverified email could neither sign in
 * nor reach the one page that resends the verification link, and from the
 * outside the login button simply did nothing.
 *
 * Segment matching also closes the rest of the class: "/team" no longer
 * matches "/teams-pricing", "/hire" no longer matches "/hiring-guide". Only
 * /verify-email changes protection today — every other route matches exactly
 * as before, /verify-id and /verify-phone included, because both are listed
 * in their own right.
 */
const matchesRoute = (pathname: string, route: string): boolean =>
  pathname === route || pathname.startsWith(`${route}/`);

// Routes only for unauthenticated users
const authRoutes = ["/login", "/signup"];

function dashboardForRole(role: string | undefined): string | null {
  if (role === "candidate") return "/candidate/dashboard";
  if (role === "client") return "/browse";
  if (role === "admin") return "/admin";
  if (role === "recruiter" || role === "recruiting_manager") return "/recruiter";
  return null;
}

export async function updateSession(request: NextRequest) {
  // Every response leaves through here so the one-time cookie-scope migration
  // cannot be missed. It matters most on the paths that redirect: a candidate
  // owing a second factor is redirected on every single request, so attaching
  // the migration only to the pass-through response would leave exactly the
  // people mid-sign-in stranded on host-only cookies for ever.
  const finish = (res: NextResponse): NextResponse => {
    migrateSessionCookieScope(request, res);
    return res;
  };

  // Host routing runs FIRST, but only a REDIRECT gets to leave here. A
  // redirect runs no page of ours, so it needs no guard.
  //
  // A rewrite must NOT short-circuit. Next runs middleware once and does not
  // re-enter it for an internal rewrite, so returning one here would skip
  // every guard below — session lookup, MFA-pending redirect, protected
  // routes, the US-experience gate — for the root of the assessment host. The
  // assessment page checks only role, so that URL would have been the single
  // place in the product where a session owing a second factor is never
  // challenged. Instead the rewritten path is carried through the guards and
  // the rewrite is emitted at the end.
  const hostRoute = routeByHost(request);
  if (hostRoute?.kind === "redirect") return hostRoute.response;

  const rewriteUrl = hostRoute?.kind === "rewrite" ? hostRoute.url : null;
  // One builder, used both here and inside the cookie setAll below — which
  // rebuilds the response and would otherwise silently drop the rewrite.
  const buildResponse = () =>
    rewriteUrl
      ? NextResponse.rewrite(rewriteUrl, { request })
      : NextResponse.next({ request });

  let supabaseResponse = buildResponse();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Sessions are shared across staffva.com and its subdomains so the
      // assessment host sees a signed-in, MFA-satisfied candidate. All three
      // Supabase clients (browser, server, this one) must write the same
      // scope, or a refresh in one of them creates a same-named cookie at a
      // narrower scope that shadows the real session.
      cookieOptions: { domain: cookieDomainForHost(request.headers.get("host")) },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = buildResponse();
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The path the guards judge. On the assessment host's root this is
  // "/assessment", not "/", so protectedRoutes and the MFA gate see the page
  // that is actually about to render rather than the URL the browser typed.
  const pathname = rewriteUrl ? rewriteUrl.pathname : request.nextUrl.pathname;

  // ── Two-step verification enforcement ──
  // A password sign-in yields a full aal1 session even when a TOTP factor is
  // enrolled; without this check, refreshing past the OTP screen (or walking
  // straight to a protected route) skipped 2FA entirely. A session that owes
  // a second factor is treated as NOT signed in everywhere except the pages
  // that let it finish (or leave) the challenge.
  let mfaPending = false;
  if (user) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    mfaPending = !!aal && aal.currentLevel === "aal1" && aal.nextLevel === "aal2";
  }
  const mfaExemptPaths = ["/login", "/forgot-password", "/reset-password", "/verify-email", "/auth", "/api"];
  if (mfaPending && !mfaExemptPaths.some((p) => pathname.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("mfa", "1");
    if (protectedRoutes.some((route) => matchesRoute(pathname, route))) {
      // Carry the query too — /verify-id?id_check=returning must survive
      // the OTP detour or the Stripe return lands on a page that never polls.
      url.searchParams.set("next", pathname + request.nextUrl.search);
    }
    return finish(NextResponse.redirect(url));
  }

  // Redirect unauthenticated users away from protected routes
  if (!user && protectedRoutes.some((route) => matchesRoute(pathname, route))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname + request.nextUrl.search);
    return finish(NextResponse.redirect(url));
  }

  // Redirect authenticated users away from auth pages and the landing page —
  // except a half-authenticated (MFA-pending) session, which must be able to
  // stay on /login to finish its code.
  if (user && !mfaPending && (authRoutes.some((route) => pathname.startsWith(route)) || pathname === "/")) {
    const role = user.app_metadata?.role;
    const dest = dashboardForRole(role);
    if (dest) {
      const url = request.nextUrl.clone();
      url.pathname = dest;
      return finish(NextResponse.redirect(url));
    }
  }

  // ── US client experience hard gate ──
  // Candidates whose us_client_experience is NULL must answer the question
  // before accessing any candidate-side route. The /apply/us-experience page
  // is the only entry point that bypasses this gate.
  if (user && user.app_metadata?.role === "candidate") {
    const requiresUsExperience =
      pathname.startsWith("/candidate") ||
      pathname.startsWith("/browse") ||
      pathname.startsWith("/profile/") ||
      (pathname.startsWith("/apply") && pathname !== "/apply/us-experience");

    if (requiresUsExperience) {
      const { data: candidate } = await supabase
        .from("candidates")
        .select("us_client_experience, application_stage")
        .eq("user_id", user.id)
        .maybeSingle();

      // Only gate candidates who have finished the original application (stage >= 3).
      // Mid-onboarding candidates (stages 1–2) still answer the question via Stage 2 of the regular form.
      if (
        candidate &&
        candidate.us_client_experience == null &&
        (candidate.application_stage ?? 0) >= 3
      ) {
        const url = request.nextUrl.clone();
        url.pathname = "/apply/us-experience";
        return finish(NextResponse.redirect(url));
      }
    }
  }

  return finish(supabaseResponse);
}
