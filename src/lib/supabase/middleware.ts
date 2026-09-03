import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Routes that require authentication
const protectedRoutes = ["/apply", "/inbox", "/admin", "/team", "/hire", "/candidate/dashboard"];

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
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
      url.searchParams.set("next", pathname);
    }
    return NextResponse.redirect(url);
  }

  // Redirect unauthenticated users away from protected routes
  if (!user && protectedRoutes.some((route) => pathname.startsWith(route))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
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
      return NextResponse.redirect(url);
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
        return NextResponse.redirect(url);
      }
    }
  }

  return supabaseResponse;
}
