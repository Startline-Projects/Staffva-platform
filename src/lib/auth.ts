import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types/database";

export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function getUserRole(): Promise<UserRole | null> {
  const user = await getUser();
  if (!user) return null;
  return (user.app_metadata?.role as UserRole) ?? null;
}

export async function getUserProfile() {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return profile;
}

export async function requireAuth() {
  const user = await getUser();
  if (!user) {
    throw new Error("Not authenticated");
  }
  return user;
}

export async function requireRole(role: UserRole) {
  const user = await requireAuth();
  const userRole = user.app_metadata?.role as UserRole;
  if (userRole !== role) {
    throw new Error(`Required role: ${role}`);
  }
  return user;
}

/**
 * Resolve the candidates.id owned by the currently authenticated user.
 * Returns null when there is no session or the user has no candidate row.
 */
export async function getOwnCandidateId(): Promise<string | null> {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("candidates")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  return data?.id ?? null;
}

/**
 * True only when the caller is authenticated and `candidateId` is their own
 * candidate record. Use to stop one candidate acting on another's data on
 * routes that take a candidateId from the request body.
 */
export async function ownsCandidate(candidateId: unknown): Promise<boolean> {
  if (typeof candidateId !== "string" || !candidateId) return false;
  const ownId = await getOwnCandidateId();
  return ownId !== null && ownId === candidateId;
}

/**
 * Shared-secret gate for internal/system-triggered routes. Fails CLOSED: if
 * CRON_SECRET is unset the route is denied rather than left open (the previous
 * `Bearer ${undefined}` pattern let anyone in by sending "Bearer undefined").
 */
export function hasCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
