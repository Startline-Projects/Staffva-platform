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

  // Host routing runs FIRST. A request that is going to be redirected to
  // another host should not pay for a getUser() round trip, and the
  // assessment host's root rewrite has to happen before the route guards
  // below reason about the pathname.
  const hostRouted = routeByHost(request);
  if (hostRouted) return hostRouted;

  let supabaseResponse = NextResponse.next({ request });

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
          supabaseResponse = NextResponse.next({ request });
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

  const pathname = request.nextUrl.pathname;

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
    if (protectedRoutes.some((route) => pathname.startsWith(route))) {
      // Carry the query too — /verify-id?id_check=returning must survive
      // the OTP detour or the Stripe return lands on a page that never polls.
      url.searchParams.set("next", pathname + request.nextUrl.search);
    }
    return finish(NextResponse.redirect(url));
  }

  // Redirect unauthenticated users away from protected routes
  if (!user && protectedRoutes.some((route) => pathname.startsWith(route))) {
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
