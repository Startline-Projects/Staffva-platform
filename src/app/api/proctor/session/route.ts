import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export const PROCTOR_CONSENT_VERSION = "2.0";

/**
 * POST /api/proctor/session — start (or resume) a proctored capture session.
 * Body: { sessionKind: 'english_test' }
 *
 * Requires the candidate's versioned proctor consent to already be stamped —
 * the gate enforces the order, this enforces the truth. One live session per
 * candidate per kind: a refresh mid-test resumes the same session rather
 * than fragmenting the recording across rows.
 */
export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { sessionKind?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const sessionKind = body.sessionKind === "english_test" ? "english_test" : null;
  if (!sessionKind) return NextResponse.json({ error: "Bad sessionKind" }, { status: 400 });

  const db = admin();
  const { data: candidate } = await db
    .from("candidates")
    .select("id, proctor_consent_at")
    .eq("user_id", user.id)
    .single();
  if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  if (!candidate.proctor_consent_at) {
    return NextResponse.json({ error: "Consent required first" }, { status: 403 });
  }

  // Resume a live session from the last hour (refresh mid-test).
  const { data: open } = await db
    .from("proctor_sessions")
    .select("id")
    .eq("candidate_id", candidate.id)
    .eq("session_kind", sessionKind)
    .eq("review_status", "recording")
    .gte("started_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (open) return NextResponse.json({ sessionId: open.id });

  const id = crypto.randomUUID();
  const { error } = await db.from("proctor_sessions").insert({
    id,
    candidate_id: candidate.id,
    session_kind: sessionKind,
    storage_prefix: `${candidate.id}/${sessionKind}/${id}`,
  });
  if (error) return NextResponse.json({ error: "Could not start session" }, { status: 500 });

  return NextResponse.json({ sessionId: id });
}
