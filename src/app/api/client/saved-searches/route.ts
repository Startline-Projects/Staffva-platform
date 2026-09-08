import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { countMatches, normalizeFilters } from "@/lib/savedSearch";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Saved searches (client step 8, migration `client_shortlists`).
 *
 * GET    — the client's searches, each with a LIVE match count and how many
 *          of those are new since they last looked.
 * POST   — save the current browse filters, or mark one as seen.
 * DELETE — remove one.
 *
 * "N new" is the difference between the live count and last_seen_count, which
 * is why the mark-seen call exists: without a high-water mark the badge would
 * say the same number forever, which is how a notification stops meaning
 * anything. It is a count difference, not a set difference — a search whose
 * pool churned by equal numbers in both directions reports nothing new, and
 * the copy says "more" rather than naming people.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Each alerting search costs one full RPC scan per digest run, forever. This
 * is the ceiling on how much work one account can schedule for the platform.
 */
const MAX_SEARCHES = 30;

async function requireClient() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (user.app_metadata?.role !== "client") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const admin = getAdminClient();
  const { data: client } = await admin
    .from("clients")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!client) return { error: NextResponse.json({ error: "Client not found" }, { status: 404 }) };
  return { admin, clientId: client.id as string };
}

export async function GET() {
  const ctx = await requireClient();
  if (ctx.error) return ctx.error;
  const { admin, clientId } = ctx;

  const { data: rows, error } = await admin!
    .from("client_saved_searches")
    .select("id, name, filters, notify, last_seen_count, last_seen_at, created_at")
    .eq("client_id", clientId!)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[saved-searches] read failed:", error.message);
    return NextResponse.json({ error: "Could not load your saved searches." }, { status: 500 });
  }

  const searches = [];
  for (const row of rows || []) {
    // Counted live against the same pool browse uses. A stored count would
    // be a number that was true once.
    const count = await countMatches(admin!, normalizeFilters(row.filters));
    searches.push({
      id: row.id,
      name: row.name,
      filters: row.filters,
      notify: row.notify,
      count,
      newSince: Math.max(0, count - (row.last_seen_count ?? 0)),
      lastSeenAt: row.last_seen_at,
    });
  }

  return NextResponse.json({ searches });
}

export async function POST(request: Request) {
  const ctx = await requireClient();
  if (ctx.error) return ctx.error;
  const { admin, clientId } = ctx;

  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "create";

  if (action === "create") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 1 || name.length > 60) {
      return NextResponse.json({ error: "Give the search a name (1–60 characters)." }, { status: 400 });
    }
    const notify = ["off", "daily", "weekly"].includes(body.notify) ? body.notify : "off";
    // Coerced, never stored raw: the jsonb written here is read back by
    // filtersToQuery/describeFilters, which index into it. See normalizeFilters.
    const filters = normalizeFilters(body.filters);

    const { count: existing } = await admin!
      .from("client_saved_searches")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId!);
    if ((existing ?? 0) >= MAX_SEARCHES) {
      return NextResponse.json(
        { error: `You've reached ${MAX_SEARCHES} saved searches. Delete one to save another.` },
        { status: 409 }
      );
    }

    // Seed the high-water mark at what it matches RIGHT NOW, so the first
    // "N new" counts arrivals since the save rather than announcing the
    // entire existing pool as new.
    const count = await countMatches(admin!, filters);

    const { data, error } = await admin!
      .from("client_saved_searches")
      .insert({
        client_id: clientId!,
        name,
        filters,
        notify,
        last_seen_count: count,
        last_seen_at: new Date().toISOString(),
        // Seeded together: the digest measures a rise against whichever of
        // the two marks is later, so leaving this at 0 would make the very
        // first run mail the whole existing pool as if it were new.
        last_notified_count: count,
      })
      .select("id, name, notify")
      .maybeSingle();

    if (error?.code === "23505") {
      return NextResponse.json({ error: "You already have a search with that name." }, { status: 409 });
    }
    if (error || !data) {
      console.error("[saved-searches] create failed:", error?.message);
      return NextResponse.json({ error: "Could not save that search." }, { status: 500 });
    }
    return NextResponse.json({ search: { id: data.id, name: data.name, notify: data.notify, count, newSince: 0 } });
  }

  if (action === "seen") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!UUID.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });

    const { data: row } = await admin!
      .from("client_saved_searches")
      .select("id, filters")
      .eq("id", id)
      .eq("client_id", clientId!)
      .maybeSingle();
    if (!row) return NextResponse.json({ error: "Not your saved search" }, { status: 403 });

    const count = await countMatches(admin!, normalizeFilters(row.filters));
    await admin!
      .from("client_saved_searches")
      .update({ last_seen_count: count, last_seen_at: new Date().toISOString() })
      .eq("id", id)
      .eq("client_id", clientId!);
    return NextResponse.json({ id, count, newSince: 0 });
  }

  if (action === "notify") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!UUID.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
    if (!["off", "daily", "weekly"].includes(body.notify)) {
      return NextResponse.json({ error: "notify must be off, daily or weekly" }, { status: 400 });
    }
    const { data, error } = await admin!
      .from("client_saved_searches")
      .update({ notify: body.notify })
      .eq("id", id)
      .eq("client_id", clientId!)
      .select("id, notify")
      .maybeSingle();
    if (error || !data) return NextResponse.json({ error: "Not your saved search" }, { status: 403 });
    return NextResponse.json({ id: data.id, notify: data.notify });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(request: Request) {
  const ctx = await requireClient();
  if (ctx.error) return ctx.error;
  const { admin, clientId } = ctx;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id") || "";
  if (!UUID.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { data, error } = await admin!
    .from("client_saved_searches")
    .delete()
    .eq("id", id)
    .eq("client_id", clientId!)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[saved-searches] delete failed:", error.message);
    return NextResponse.json({ error: "Could not delete that search." }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Not your saved search" }, { status: 403 });
  return NextResponse.json({ deleted: id });
}
