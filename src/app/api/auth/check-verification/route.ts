import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * POST /api/auth/check-verification
 * Body: { userId }
 * Returns whether the user's email is verified.
 *
 * ON FAILING OPEN — kept deliberately, and worth saying why, because "fails
 * open" reads like a bug.
 *
 * This is not an authorization gate. Supabase Auth decides who is signed in;
 * `email_verified` appears nowhere outside src/app/api/auth/ and there is no
 * middleware enforcing it, so this endpoint drives a prompt on the login page
 * and nothing more. Failing CLOSED would mean that during any database hiccup
 * every user — verified or not — is told to go and verify their email and
 * cannot get in. That is the exact failure this codebase has been audited for,
 * and it would be self-inflicted at the worst possible moment: a spike, when
 * statement timeouts are most likely.
 *
 * So the policy stays. What changes is that the three DIFFERENT situations
 * below stop being collapsed into one silent `{verified:true}`. A malformed
 * request, a genuinely absent profile and a failing database are not the same
 * event, and previously the query's error was discarded entirely — a failed
 * lookup was indistinguishable from "no such profile". If this endpoint starts
 * admitting everyone because the database is unwell, that should be visible in
 * the logs rather than inferred later from a pile of unverified accounts.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();

    if (!userId) {
      // A malformed request, not a verification result. Nothing to look up.
      console.warn("[check-verification] called without a userId; allowing through");
      return NextResponse.json({ verified: true, active: true, reason: "no_user_id" });
    }

    const admin = getAdminClient();

    const { data: profile, error } = await admin
      .from("profiles")
      .select("email_verified, suspended_at")
      .eq("id", userId)
      .single();

    if (error) {
      // PGRST116 is "no rows", which is the legitimate not-found case below.
      // Anything else is the database failing, and that must not look the same.
      if (error.code !== "PGRST116") {
        console.error(
          "[check-verification] profile lookup failed, allowing through:",
          JSON.stringify({ userId, code: error.code, message: error.message })
        );
        return NextResponse.json({ verified: true, active: true, reason: "lookup_failed" });
      }
    }

    if (!profile) {
      // The row is created by a trigger just after signup, so a brand-new user
      // can legitimately arrive here before it exists.
      return NextResponse.json({ verified: true, active: true, reason: "no_profile_yet" });
    }

    return NextResponse.json({
      verified: profile.email_verified !== false,
      // Suspension marker, same fail-open posture: only an explicit stamp
      // suspends — a missing column or row never locks anyone out. NOT
      // is_active: that is 00063's recruiter-rotation flag.
      active: !profile.suspended_at,
    });
  } catch (err) {
    console.error(
      "[check-verification] threw, allowing through:",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json({ verified: true, active: true, reason: "error" });
  }
}
