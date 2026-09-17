import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { recordAdminAction } from "@/lib/adminAudit";
import { loadScreeningHealth } from "@/lib/adminScreening";

/**
 * Put candidates back in the screening queue.
 *
 * Deliberately a re-enqueue rather than a loop that calls the model directly.
 * The cron already owns every hard part — claiming with an optimistic lock,
 * backing off on 429, capping retries, refusing to screen a record still at
 * stage 1, and emailing when something fails permanently. A second path to the
 * same model would be a second place for all of that to be got wrong, and the
 * one thing this queue must not do is stampede the API on an admin's click.
 *
 * The work itself happens on the cron's schedule, 25 at a time. This route
 * only marks it as owed, which is why it answers with a count of rows queued
 * and not with results.
 */

/** Enough to see whether the rubric spreads the pool, cheap enough to discard. */
const SAMPLE_SIZE = 20;

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function requireStaff() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const role = user.app_metadata?.role;
  if (role !== "admin" && role !== "recruiting_manager") return null;
  const { data: profile } = await admin()
    .from("profiles").select("id, full_name, email, role").eq("id", user.id).single();
  if (!profile) return null;
  return profile as { id: string; full_name: string | null; email: string; role: "admin" | "recruiting_manager" };
}

export async function POST(req: NextRequest) {
  const actor = await requireStaff();
  if (!actor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const scope = ["stale", "all", "sample"].includes(body.scope) ? (body.scope as "stale" | "all" | "sample") : null;
  const explicit = Array.isArray(body.candidateIds)
    ? body.candidateIds.filter((v: unknown): v is string => typeof v === "string")
    : null;

  if (!scope && !explicit?.length) {
    return NextResponse.json({ error: "Nothing was selected to re-screen." }, { status: 400 });
  }

  let ids: string[];
  if (explicit?.length) {
    ids = explicit;
  } else {
    // Recomputed here rather than trusted from the client: a list posted from
    // a page loaded an hour ago would re-screen whatever was stale then.
    const health = await loadScreeningHealth();
    if (!health) {
      return NextResponse.json({ error: "Could not work out what needs re-screening." }, { status: 500 });
    }
    if (scope === "all") {
      const { data, error } = await admin().from("candidates").select("id");
      if (error || !data) return NextResponse.json({ error: "Could not read the candidates." }, { status: 500 });
      ids = data.map((c) => c.id as string);
    } else if (scope === "sample") {
      // One per role family, up to SAMPLE_SIZE.
      //
      // This whole defect is what happens when a rubric is applied to the
      // entire pool and nobody reads the output. A sample that is just the
      // first twenty rows would not catch it either — the old rubric's
      // failure was per-role, and twenty Virtual Assistants all failing the
      // same way looks identical to twenty candidates being weak. Spreading
      // across families is what makes the result legible.
      const { data, error } = await admin()
        .from("candidates").select("id, role_category").in("id", health.stale);
      if (error || !data) return NextResponse.json({ error: "Could not read the candidates." }, { status: 500 });

      const seen = new Set<string>();
      const spread: string[] = [];
      const rest: string[] = [];
      for (const c of data) {
        const key = (c.role_category as string | null) ?? "(none)";
        if (seen.has(key)) rest.push(c.id as string);
        else { seen.add(key); spread.push(c.id as string); }
      }
      ids = [...spread, ...rest].slice(0, SAMPLE_SIZE);
    } else {
      ids = health.stale;
    }
  }

  if (ids.length === 0) {
    return NextResponse.json({ queued: 0, message: "Nothing needed re-screening." });
  }

  const db = admin();

  // Upsert on candidate_id: a candidate already holding a queue row is reset
  // to pending rather than given a second one. Two rows for one candidate
  // would be two model calls and a race over which answer lands last.
  const { error: upsertErr } = await db.from("screening_queue").upsert(
    ids.map((candidate_id) => ({
      candidate_id,
      status: "pending",
      processed_at: null,
      claimed_at: null,
      next_retry_at: null,
      retry_count: 0,
      alerted_at: null,
      error_text: "re-queued: tag predated the candidate's profile or the current rubric",
    })),
    { onConflict: "candidate_id" }
  );

  if (upsertErr) {
    return NextResponse.json(
      { error: `Nothing was queued: ${upsertErr.message}` },
      { status: 500 }
    );
  }

  // The tags themselves are deliberately NOT cleared. A candidate keeps the
  // tag they have until a new one replaces it — blanking 247 rows up front
  // would empty every triage board and recruiter queue for however long the
  // cron takes to drain, to show nothing more true than what was there.
  const recorded = await recordAdminAction({
    actorId: actor.id,
    actorRole: actor.role,
    action: "candidate.rescreen_queued",
    subjectType: "candidate",
    subjectId: null,
    summary: `Queued ${ids.length} candidate${ids.length === 1 ? "" : "s"} for re-screening`,
    detail: { scope: scope ?? "explicit", count: ids.length, candidateIds: ids.slice(0, 50) },
  });

  return NextResponse.json({
    queued: ids.length,
    warnings: recorded ? [] : ["the action was not written to the audit log"],
  });
}
