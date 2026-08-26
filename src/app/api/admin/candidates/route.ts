import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { assertRecruiterScope } from "@/lib/recruiterScope";
import { selectIn } from "@/lib/selectIn";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function verifyAdmin() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.app_metadata?.role === "admin" ? user : null;
}

async function verifyAdminOrRecruiter() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = user?.app_metadata?.role;
  if (role !== "admin" && role !== "recruiter" && role !== "recruiting_manager") return null;
  return user;
}

// GET — list candidates for review
export async function GET(request: Request) {
  const admin = await verifyAdminOrRecruiter();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view") || "filtered"; // "filtered" or "all"
  const status = searchParams.get("status") || (view === "all" ? "all" : "active");
  const search = searchParams.get("search") || "";
  // Screening tag was filtered in the browser, which required loading every row.
  const screening = searchParams.get("screening") || "all";
  const pending = searchParams.get("pending") === "1";

  // This route used to return every candidate matching a status, with no limit
  // and all 134 columns — about 12MB of rows at the 10,000-candidate target,
  // and enough ids to blow past the ~1,650-id ceiling on the `.in()` queries
  // below. Pagination bounds both.
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(
    200,
    Math.max(1, parseInt(searchParams.get("pageSize") || "100", 10) || 100)
  );

  const supabase = getAdminClient();

  // Both the page query and the per-tag counts must see the same filters, or
  // the tab counts describe a different population than the list beneath them.
  // Applied through a deliberately narrow structural type: making this generic
  // over the PostgREST builder sends tsc into "type instantiation is
  // excessively deep" on the real query types.
  type Filterable = {
    eq: (column: string, value: unknown) => Filterable;
    or: (filters: string) => Filterable;
  };

  function applyFilters<Q>(q: Q): Q {
    let out = q as unknown as Filterable;
    if (status !== "all") out = out.eq("admin_status", status);
    if (search.trim()) {
      out = out.or(
        `full_name.ilike.%${search}%,country.ilike.%${search}%,email.ilike.%${search}%`
      );
    }
    return out as unknown as Q;
  }

  let query = applyFilters(
    supabase.from("candidates").select("*", { count: "exact" })
  );

  if (screening !== "all") query = query.eq("screening_tag", screening);

  // The pending view ordered by screening priority in the browser. That now
  // happens here, via the generated screening_priority column (migration
  // 00105), with created_at as a tiebreaker — paginating over a
  // non-deterministic order repeats and skips rows between pages, and with
  // only three priority values ties are the normal case.
  query = pending
    ? query
        .order("screening_priority", { ascending: true })
        .order("created_at", { ascending: false })
    : query.order("created_at", { ascending: false });

  const from = (page - 1) * pageSize;
  const { data: candidates, count: total, error: listError } = await query.range(
    from,
    from + pageSize - 1
  );

  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }

  // Per-tag counts for the filter tabs. These were derived from the fully
  // loaded list, so they silently became "counts of whatever happened to be on
  // this page" the moment pagination existed. Counted in the database instead.
  const tagCounts: Record<string, number> = {};
  await Promise.all(
    ["Priority", "Review", "Hold"].map(async (tag) => {
      const { count } = await applyFilters(
        supabase.from("candidates").select("id", { count: "exact", head: true })
      ).eq("screening_tag", tag);
      tagCounts[tag] = count ?? 0;
    })
  );

  // Get cheat events and second interview scores for each candidate
  const candidateIds = (candidates || []).map((c) => c.id);

  // Chunked: this query is unbounded, so at the 10k target candidateIds runs to
  // several thousand and a single .in() would exceed the ~1,650-id URL ceiling
  // and drop the connection. See src/lib/selectIn.ts for the measurements.
  const [{ data: testEvents }, { data: interviews }] = await Promise.all([
    selectIn(candidateIds, (chunk) =>
      supabase
        .from("test_events")
        .select("*")
        .in("candidate_id", chunk)
    ),
    selectIn(candidateIds, (chunk) =>
      supabase
        .from("candidate_interviews")
        .select("candidate_id, communication_score, demeanor_score, role_knowledge_score, conducted_at")
        .eq("interview_number", 2)
        .eq("status", "completed")
        .in("candidate_id", chunk)
        .order("conducted_at", { ascending: false })
    ),
  ]);

  // Group events by candidate
  const eventsByCandidate: Record<string, typeof testEvents> = {};
  for (const event of testEvents || []) {
    if (!eventsByCandidate[event.candidate_id]) {
      eventsByCandidate[event.candidate_id] = [];
    }
    eventsByCandidate[event.candidate_id]!.push(event);
  }

  // Keep only the most recent interview per candidate
  const interviewByCandidate: Record<string, { communication_score: number | null; demeanor_score: number | null; role_knowledge_score: number | null }> = {};
  for (const iv of interviews || []) {
    if (!interviewByCandidate[iv.candidate_id]) {
      interviewByCandidate[iv.candidate_id] = iv;
    }
  }

  const enriched = (candidates || []).map((c) => {
    const iv = interviewByCandidate[c.id];
    return {
      ...c,
      test_events: eventsByCandidate[c.id] || [],
      second_interview_communication_score: iv?.communication_score ?? null,
      second_interview_demeanor_score: iv?.demeanor_score ?? null,
      second_interview_role_knowledge_score: iv?.role_knowledge_score ?? null,
    };
  });

  return NextResponse.json({
    candidates: enriched,
    total: total ?? 0,
    page,
    pageSize,
    tagCounts,
  });
}

// PATCH — update specific candidate fields (earnings, deactivate, etc.)
export async function PATCH(request: Request) {
  const caller = await verifyAdminOrRecruiter();
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const callerRole = caller.app_metadata?.role;

  const body = await request.json();
  const candidateId = body.candidateId;
  const updates = body.updates || {};

  // Accept top-level assigned_recruiter / assignment_pending_review (admin routing UI sends them outside updates)
  if (body.assigned_recruiter !== undefined) updates.assigned_recruiter = body.assigned_recruiter;
  if (body.assignment_pending_review !== undefined) updates.assignment_pending_review = body.assignment_pending_review;

  if (!candidateId || Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // Scope enforcement: recruiters may only act on candidates in their assigned categories
  if (callerRole === "recruiter") {
    const scopeError = await assertRecruiterScope(caller.id, candidateId);
    if (scopeError) {
      return NextResponse.json({ error: scopeError.error }, { status: scopeError.status });
    }
  }

  // Recruiters may only edit total_earnings_usd; admins and recruiting_manager may edit all allowed fields
  const allowedFields =
    callerRole === "admin" || callerRole === "recruiting_manager"
      ? ["total_earnings_usd", "admin_status", "assigned_recruiter", "assignment_pending_review"]
      : ["total_earnings_usd"];
  const safeUpdates: Record<string, unknown> = {};
  for (const key of Object.keys(updates)) {
    if (allowedFields.includes(key)) {
      safeUpdates[key] = updates[key];
    }
  }

  if (Object.keys(safeUpdates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const supabase = getAdminClient();
  const { error } = await supabase
    .from("candidates")
    .update(safeUpdates)
    .eq("id", candidateId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
