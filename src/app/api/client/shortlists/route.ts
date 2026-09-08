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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Enough lists for real use; not enough to be a write amplifier. */
const MAX_LISTS = 50;

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
    const { count: listCount } = await admin!
      .from("client_shortlists")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId!);
    if ((listCount ?? 0) >= MAX_LISTS) {
      return NextResponse.json(
        { error: `You've reached ${MAX_LISTS} lists. Delete one to make another.` },
        { status: 409 }
      );
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

  // ── Rename a list ─────────────────────────────────────────────────────────
  // Atlas has a rename control; the first draft of this dropped it, which made
  // a mistyped list name permanent — there is no other way to change one.
  if (action === "rename") {
    const id = typeof body.id === "string" ? body.id : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!UUID.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
    if (name.length < 1 || name.length > 60) {
      return NextResponse.json({ error: "Give the list a name (1–60 characters)." }, { status: 400 });
    }
    const { data, error } = await admin!
      .from("client_shortlists")
      .update({ name })
      .eq("id", id)
      .eq("client_id", clientId!)
      .select("id, name")
      .maybeSingle();
    if (error?.code === "23505") {
      return NextResponse.json({ error: "You already have a list with that name." }, { status: 409 });
    }
    if (error || !data) return NextResponse.json({ error: "Not your shortlist" }, { status: 403 });
    return NextResponse.json({ id: data.id, name: data.name });
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
        // A client who already has a list called "Saved" would collide with
        // the per-client name index, and the first draft then returned 500 on
        // EVERY plain heart click, permanently, with no rename control to
        // escape it. So the name gives way — the default list's identity is
        // is_default, not its label.
        const candidates = ["Saved", "Saved candidates", "My saved list"];
        for (let i = 0; i < candidates.length && !shortlistId; i++) {
          const { data: created, error: createErr } = await admin!
            .from("client_shortlists")
            .insert({ client_id: clientId!, name: candidates[i], is_default: true })
            .select("id")
            .maybeSingle();
          if (created) {
            shortlistId = created.id;
            break;
          }
          // Two hearts clicked at once: one insert wins the partial unique
          // index on is_default, the loser re-reads rather than failing the
          // click. This also catches the name collision, where the re-read
          // finds nothing and the loop tries the next name.
          const { data: raced } = await admin!
            .from("client_shortlists")
            .select("id")
            .eq("client_id", clientId!)
            .eq("is_default", true)
            .maybeSingle();
          if (raced) {
            shortlistId = raced.id;
            break;
          }
          if (i === candidates.length - 1) {
            console.error("[shortlists] default create failed:", createErr?.message);
            return NextResponse.json(
              { error: "Could not save that candidate. Try saving to a named list." },
              { status: 500 }
            );
          }
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
      // The candidate must be someone this client could actually have found.
      // Without this the only integrity check is the foreign key, so anyone
      // holding a candidate UUID from another surface could shortlist a
      // pending, rejected or blocked profile and read their name, photo,
      // country and rate off the list page — directory data the marketplace
      // deliberately withholds. Removal is deliberately NOT gated: a client
      // must always be able to clear their own list.
      const { data: cand, error: candErr } = await admin!
        .from("candidates")
        .select("id, admin_status, permanently_blocked")
        .eq("id", candidateId)
        .maybeSingle();
      if (candErr) {
        console.error("[shortlists] candidate check failed:", candErr.message);
        return NextResponse.json({ error: "Could not save that candidate." }, { status: 500 });
      }
      // Fails closed: an unreadable or missing candidate is not saveable.
      if (!cand || cand.admin_status !== "approved" || cand.permanently_blocked) {
        return NextResponse.json({ error: "That profile isn't available." }, { status: 403 });
      }

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
    // The name comes back too: when this call CREATED the default list, the
    // browser has no other way to label the row it is about to render, and
    // the server may have had to fall back past "Saved" on a name collision.
    const { data: named } = await admin!
      .from("client_shortlists")
      .select("name")
      .eq("id", shortlistId)
      .maybeSingle();
    return NextResponse.json({ shortlistId, shortlistName: named?.name ?? null, saved: action === "add" });
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

  // The default list is not deletable. The UI already hides the button, but
  // an invariant that lives only in a React component is not an invariant:
  // deleting it cascades away every saved member AND leaves the next heart
  // click to create a fresh one.
  const { data: target } = await admin!
    .from("client_shortlists")
    .select("id, is_default")
    .eq("id", id)
    .eq("client_id", clientId!)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: "Not your shortlist" }, { status: 403 });
  if (target.is_default) {
    return NextResponse.json(
      { error: "That's your default list — the heart saves into it. Empty it instead." },
      { status: 409 }
    );
  }

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
