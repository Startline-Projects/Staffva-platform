import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Named shortlists (client step 8, migration 00223).
 *
 * GET    — the client's lists with member counts. `?candidateId=` adds a
 *          per-list `contains` flag; `?withMembers=1` returns the whole
 *          candidate→lists map, which is how a page of 24 hearts renders its
 *          own state from one request instead of 24.
 * POST   — create a list, or add/remove a candidate.
 * DELETE — remove a list.
 *
 * Every write is service-role behind an ownership check; the tables grant the
 * browser SELECT only. A client who could write these directly could add
 * rows to another client's list, and the shortlist is the one place that
 * records who they are considering.
 *
 * No share links: the owner's D6 keeps shortlists inside the account.
 */

const UUID = /^[0-9a-f-]{36}$/i;

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

export async function GET(request: Request) {
  const ctx = await requireClient();
  if (ctx.error) return ctx.error;
  const { admin, clientId } = ctx;

  const { searchParams } = new URL(request.url);
  const candidateId = searchParams.get("candidateId");
  const withMembers = searchParams.get("withMembers") === "1";

  const { data: lists, error } = await admin!
    .from("client_shortlists")
    .select("id, name, is_default, created_at, client_shortlist_members(candidate_id)")
    .eq("client_id", clientId!)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[shortlists] read failed:", error.message);
    return NextResponse.json({ error: "Could not load your shortlists." }, { status: 500 });
  }

  // candidate id → the ids of this client's lists holding them. Only built
  // when asked for; a list page wants counts, not the whole membership.
  const memberMap: Record<string, string[]> = {};

  const shaped = (lists || []).map((l) => {
    const members = (l.client_shortlist_members as { candidate_id: string }[] | null) || [];
    if (withMembers) {
      for (const m of members) {
        (memberMap[m.candidate_id] ||= []).push(l.id as string);
      }
    }
    return {
      id: l.id,
      name: l.name,
      isDefault: l.is_default,
      count: members.length,
      // Only answered when asked about a specific candidate — the profile's
      // save menu needs it, a list page does not.
      contains: candidateId ? members.some((m) => m.candidate_id === candidateId) : undefined,
    };
  });

  return NextResponse.json(withMembers ? { shortlists: shaped, members: memberMap } : { shortlists: shaped });
}

export async function POST(request: Request) {
  const ctx = await requireClient();
  if (ctx.error) return ctx.error;
  const { admin, clientId } = ctx;

  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "";

  // ── Create a list ─────────────────────────────────────────────────────────
  if (action === "create") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 1 || name.length > 60) {
      return NextResponse.json({ error: "Give the list a name (1–60 characters)." }, { status: 400 });
    }
    const { data, error } = await admin!
      .from("client_shortlists")
      .insert({ client_id: clientId!, name })
      .select("id, name, is_default")
      .maybeSingle();
    // 23505 = the per-client name index. That is a message, not a 500.
    if (error?.code === "23505") {
      return NextResponse.json({ error: "You already have a list with that name." }, { status: 409 });
    }
    if (error || !data) {
      console.error("[shortlists] create failed:", error?.message);
      return NextResponse.json({ error: "Could not create that list." }, { status: 500 });
    }
    return NextResponse.json({ shortlist: { id: data.id, name: data.name, isDefault: data.is_default, count: 0 } });
  }

  // ── Add / remove a candidate ──────────────────────────────────────────────
  if (action === "add" || action === "remove") {
    const candidateId = typeof body.candidateId === "string" ? body.candidateId : "";
    if (!UUID.test(candidateId)) {
      return NextResponse.json({ error: "candidateId required" }, { status: 400 });
    }

    let shortlistId = typeof body.shortlistId === "string" ? body.shortlistId : "";
    if (shortlistId && !UUID.test(shortlistId)) {
      return NextResponse.json({ error: "shortlistId invalid" }, { status: 400 });
    }

    if (!shortlistId) {
      // The heart with no list chosen: use the default, creating it the first
      // time. Named "Saved" rather than something clever, because the client
      // did not name it and will see it in their own list of lists.
      const { data: existing } = await admin!
        .from("client_shortlists")
        .select("id")
        .eq("client_id", clientId!)
        .eq("is_default", true)
        .maybeSingle();
      if (existing) {
        shortlistId = existing.id;
      } else {
        const { data: created, error: createErr } = await admin!
          .from("client_shortlists")
          .insert({ client_id: clientId!, name: "Saved", is_default: true })
          .select("id")
          .maybeSingle();
        if (createErr || !created) {
          // Two hearts clicked at once: one insert wins the partial unique
          // index, the loser re-reads rather than failing the click.
          const { data: raced } = await admin!
            .from("client_shortlists")
            .select("id")
            .eq("client_id", clientId!)
            .eq("is_default", true)
            .maybeSingle();
          if (!raced) {
            console.error("[shortlists] default create failed:", createErr?.message);
            return NextResponse.json({ error: "Could not save that candidate." }, { status: 500 });
          }
          shortlistId = raced.id;
        } else {
          shortlistId = created.id;
        }
      }
    } else {
      // An explicit list must be THIS client's. Without this check a client
      // could write into a stranger's shortlist by guessing an id.
      const { data: owned } = await admin!
        .from("client_shortlists")
        .select("id")
        .eq("id", shortlistId)
        .eq("client_id", clientId!)
        .maybeSingle();
      if (!owned) return NextResponse.json({ error: "Not your shortlist" }, { status: 403 });
    }

    if (action === "add") {
      const { error } = await admin!
        .from("client_shortlist_members")
        .upsert(
          { shortlist_id: shortlistId, candidate_id: candidateId },
          { onConflict: "shortlist_id,candidate_id", ignoreDuplicates: true }
        );
      if (error) {
        console.error("[shortlists] add failed:", error.message);
        return NextResponse.json({ error: "Could not save that candidate." }, { status: 500 });
      }
    } else {
      const { error } = await admin!
        .from("client_shortlist_members")
        .delete()
        .eq("shortlist_id", shortlistId)
        .eq("candidate_id", candidateId);
      if (error) {
        console.error("[shortlists] remove failed:", error.message);
        return NextResponse.json({ error: "Could not remove that candidate." }, { status: 500 });
      }
    }
    return NextResponse.json({ shortlistId, saved: action === "add" });
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

  // Scoped to the caller's own rows, so a guessed id deletes nothing.
  const { data, error } = await admin!
    .from("client_shortlists")
    .delete()
    .eq("id", id)
    .eq("client_id", clientId!)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[shortlists] delete failed:", error.message);
    return NextResponse.json({ error: "Could not delete that list." }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Not your shortlist" }, { status: 403 });
  return NextResponse.json({ deleted: id });
}
