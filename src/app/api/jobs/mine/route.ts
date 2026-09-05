import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const VISIBLE_DAYS = 45; // mirrors jobs_for_candidate (00192) — defined there in SQL

/**
 * A client's own role posts — the surface that didn't exist. A published post
 * stays candidate-visible for 45 days while the client, having closed the
 * tab, could never again see who matched or send the invitation the ranking
 * treats as the platform's only human-curated signal.
 */
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const db = admin();
  // error checked separately: a DB hiccup must not read as "you have no
  // posts" — the honest-500 convention the queries below already follow.
  const { data: client, error: clientErr } = await db
    .from("clients").select("id").eq("user_id", user.id).maybeSingle();
  if (clientErr) {
    return NextResponse.json({ error: "Could not load your posts." }, { status: 500 });
  }
  if (!client) return NextResponse.json({ posts: [] });

  const { data: posts, error } = await db
    .from("job_posts")
    .select("id, title, role_category, status, published_at, created_at")
    .eq("client_id", client.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    return NextResponse.json({ error: "Could not load your posts." }, { status: 500 });
  }

  const ids = (posts ?? []).map((p) => p.id);
  const counts = new Map<string, { matches: number; invited: number }>();
  if (ids.length > 0) {
    const { data: matchRows } = await db
      .from("job_post_matches")
      .select("job_post_id, invited_at")
      .in("job_post_id", ids);
    for (const m of matchRows ?? []) {
      const c = counts.get(m.job_post_id) ?? { matches: 0, invited: 0 };
      c.matches++;
      if (m.invited_at) c.invited++;
      counts.set(m.job_post_id, c);
    }
  }

  const now = Date.now();
  return NextResponse.json({
    posts: (posts ?? []).map((p) => {
      const publishedAt = p.published_at ? new Date(p.published_at).getTime() : null;
      const expiresAt =
        publishedAt !== null ? new Date(publishedAt + VISIBLE_DAYS * 24 * 3600 * 1000) : null;
      return {
        ...p,
        matches: counts.get(p.id)?.matches ?? 0,
        invited: counts.get(p.id)?.invited ?? 0,
        expires_at: expiresAt?.toISOString() ?? null,
        // job_is_open's four conjuncts (00192), exactly. The first version
        // tested status === "published" — a value that isn't even in the
        // enum (the publish path writes 'active' + published_at), so every
        // live post would have read "Not published": the inverse of the
        // problem this endpoint exists to fix.
        visible_to_candidates:
          p.status === "active" &&
          publishedAt !== null &&
          now - publishedAt < VISIBLE_DAYS * 24 * 3600 * 1000 &&
          p.title != null,
      };
    }),
  });
}
