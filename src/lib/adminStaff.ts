import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { StaffRole } from "@/lib/adminCapabilities";

/**
 * Server-side loaders for the profile and staff pages.
 *
 * These are read directly by server components rather than through an API
 * route. Both pages are read-only, so a client fetch would buy nothing and
 * cost a round trip, a loading state, and an error state that has to be told
 * apart from an empty one — the exact ambiguity that left the old dashboard
 * spinning forever on a failed read.
 *
 * Server-only by construction: `loadStaff` reads `SUPABASE_SERVICE_ROLE_KEY`,
 * which is undefined in the browser, and `@/lib/supabase/server` reads
 * cookies. Never import this from a "use client" module — the repo does not
 * carry the `server-only` package, so nothing will stop you at build time.
 */

export interface OwnProfile {
  id: string;
  role: StaffRole;
  fullName: string | null;
  email: string;
  phone: string | null;
  phoneVerified: boolean;
  emailVerified: boolean;
  photoUrl: string | null;
  joinedAt: string;
  lastSignInAt: string | null;
  isActive: boolean;
  suspendedAt: string | null;
  mfaFactors: number;
}

export interface StaffMember {
  id: string;
  fullName: string | null;
  email: string;
  role: StaffRole;
  isActive: boolean;
  suspendedAt: string | null;
  joinedAt: string;
  photoUrl: string | null;
  /** null = the auth record could not be read, which is not the same as never. */
  lastSignInAt: string | null;
  mfaFactors: number | null;
  isYou: boolean;
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function loadOwnProfile(): Promise<OwnProfile | null> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = user?.app_metadata?.role;
  if (!user || (role !== "admin" && role !== "recruiting_manager")) return null;

  // Their own row, read with their own session — no service key. Reaching for
  // elevation on a read that does not need it is how one turns into an
  // escalation later.
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, phone_number, phone_verified_at, created_at, is_active, suspended_at, recruiter_photo_url")
    .eq("id", user.id)
    .single();

  if (!profile) return null;

  // Verified factors only. An abandoned enrolment is a factor that protects
  // nothing, and counting it would report security that is not there.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = [...(factors?.totp ?? []), ...(factors?.phone ?? [])]
    .filter((f) => f.status === "verified").length;

  return {
    id: user.id,
    role: role as StaffRole,
    fullName: profile.full_name,
    email: profile.email,
    phone: profile.phone_number,
    phoneVerified: Boolean(profile.phone_verified_at),
    emailVerified: Boolean(user.email_confirmed_at),
    photoUrl: profile.recruiter_photo_url,
    joinedAt: profile.created_at,
    lastSignInAt: user.last_sign_in_at ?? null,
    isActive: profile.is_active,
    suspendedAt: profile.suspended_at,
    mfaFactors: verified,
  };
}

export async function loadStaff(): Promise<StaffMember[] | null> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = user?.app_metadata?.role;
  if (!user || (role !== "admin" && role !== "recruiting_manager")) return null;

  const admin = serviceClient();

  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id, full_name, email, role, is_active, suspended_at, created_at, recruiter_photo_url")
    .in("role", ["admin", "recruiting_manager"])
    .order("role")
    .order("created_at");

  if (error || !profiles) return null;

  // `last_sign_in_at` and the factor list live in auth.users, which only the
  // service key can read. It is the one honest answer to "when were they last
  // here" — `profiles.updated_at` is a row-touch timestamp and means nothing
  // of the sort, though the client dashboard has long displayed it as a login.
  const authInfo = new Map<string, { lastSignInAt: string | null; mfaFactors: number }>();
  let page = 1;
  for (;;) {
    const { data, error: authError } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (authError || !data?.users?.length) break;
    for (const u of data.users) {
      authInfo.set(u.id, {
        lastSignInAt: u.last_sign_in_at ?? null,
        mfaFactors: (u.factors ?? []).filter((f) => f.status === "verified").length,
      });
    }
    if (data.users.length < 200) break;
    page += 1;
  }

  return profiles.map((p) => {
    const auth = authInfo.get(p.id);
    return {
      id: p.id,
      fullName: p.full_name,
      email: p.email,
      role: p.role as StaffRole,
      isActive: p.is_active,
      suspendedAt: p.suspended_at,
      joinedAt: p.created_at,
      photoUrl: p.recruiter_photo_url,
      lastSignInAt: auth ? auth.lastSignInAt : null,
      mfaFactors: auth ? auth.mfaFactors : null,
      isYou: p.id === user.id,
    };
  });
}
