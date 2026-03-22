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
  return (user.user_metadata?.role as UserRole) ?? null;
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
  const userRole = user.user_metadata?.role as UserRole;
  if (userRole !== role) {
    throw new Error(`Required role: ${role}`);
  }
  return user;
}
