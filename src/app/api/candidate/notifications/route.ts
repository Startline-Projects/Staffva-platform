import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * The bell. GET returns the latest 30 notifications plus the true unread
 * count; POST marks read (all, or the ids given).
 *
 * Both run on the CALLER'S client: RLS scopes reads to the owner, and
 * mark_my_notifications_read() resolves auth.uid() itself — so there is no id
 * in the request that could name someone else's rows.
 */
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const [{ data: rows, error }, { count, error: countError }] = await Promise.all([
    supabase
      .from("candidate_notifications")
      .select("id, category, title, body, route, created_at, read_at")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("candidate_notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null),
  ]);
  if (error || countError) {
    console.error("[notifications] read failed:", error?.message ?? countError?.message);
    return NextResponse.json({ error: "Could not load notifications." }, { status: 500 });
  }
  // The list is capped at 30; the badge count is not — a count derived from
  // the capped list would silently stick at 30.
  return NextResponse.json({ notifications: rows ?? [], unread: count ?? 0 });
}

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const ids: unknown = body.ids;
  const p_ids =
    Array.isArray(ids) && ids.every((i) => typeof i === "string") && ids.length > 0
      ? (ids as string[])
      : null;

  const { data: marked, error } = await supabase.rpc("mark_my_notifications_read", { p_ids });
  if (error) {
    console.error("[notifications] mark-read failed:", error.message);
    return NextResponse.json({ error: "Could not update notifications." }, { status: 500 });
  }
  return NextResponse.json({ marked: marked ?? 0 });
}
