import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { DORMANT_AFTER_DAYS } from "@/lib/adminAlerts";

/**
 * Who a candidate can be reassigned to.
 *
 * `is_active` is not a proxy for present. Every one of the eight specialists
 * holding a queue is flagged active and none has signed in for months, so a
 * list filtered on that column alone offered them all as valid destinations
 * with nothing to tell them apart — and moving a waiting candidate from one
 * absent person to another was reported as a successful fix.
 *
 * The dormant are still returned, because a deliberate move to a specific
 * person has to stay possible and silently hiding staff would be its own lie.
 * They come back labelled, and last, so the caller can say so.
 */

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function getAuthorizedProfile(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const { data: { user } } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  ).auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await admin()
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();
  if (!profile || !["admin", "recruiting_manager"].includes(profile.role)) return null;
  return profile as { id: string; role: string };
}

export async function GET(req: NextRequest) {
  const profile = await getAuthorizedProfile(req);
  if (!profile) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = admin();
  const { data, error } = await db
    .from("profiles")
    .select("id, full_name, email")
    .in("role", ["recruiter", "recruiting_manager", "admin"])
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: authData, error: authErr } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  // A failed sign-in read leaves lastSignInAt undefined on every row, and the
  // picker then says it does not know — rather than labelling everyone fresh.
  const seen = authErr
    ? null
    : new Map((authData?.users ?? []).map((u) => [u.id, u.last_sign_in_at ?? null]));

  const now = Date.now();
  const recruiters = (data ?? []).map((r) => {
    if (!seen) return { ...r, lastSignInAt: null, daysSinceSignIn: null, dormant: null };
    const at = seen.get(r.id) ?? null;
    const days = at === null ? null : Math.floor((now - new Date(at).getTime()) / 86_400_000);
    return {
      ...r,
      lastSignInAt: at,
      daysSinceSignIn: days,
      // Never signed in is dormant, not unknown: the account has never been used.
      dormant: days === null || days >= DORMANT_AFTER_DAYS,
    };
  });

  recruiters.sort((a, b) => {
    if (a.dormant !== b.dormant) return a.dormant ? 1 : -1;
    return (a.full_name || "").localeCompare(b.full_name || "");
  });

  return NextResponse.json({ recruiters, signInsRead: seen !== null, dormantAfterDays: DORMANT_AFTER_DAYS });
}
