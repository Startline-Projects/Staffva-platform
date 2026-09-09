import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import {
  SHAREABLE_SCORECARD_COLUMNS,
  hasTranscriptAccess,
  normaliseTranscript,
} from "@/lib/transcriptAccess";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * GET /api/client/transcripts/[candidateId] — one candidate's interview
 * transcript and scorecard, for a client who has paid for access.
 *
 * The paywall is HERE, on the server, and the page renders whatever this
 * returns. A client-side check over data already in the payload is not a
 * paywall — it is a CSS class over a transcript that has already been sent.
 *
 * ai_notes is not selected. SHAREABLE_SCORECARD_COLUMNS is the whole column
 * list and the reason it excludes ai_notes is written there.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ candidateId: string }> }
) {
  const { candidateId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidateId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const db = admin();
  const { data: client, error: clientErr } = await db
    .from("clients")
    .select("id, transcript_access_status, transcript_access_until, transcript_access_interval")
    .eq("user_id", user.id)
    .maybeSingle();
  if (clientErr) {
    console.error("[transcripts] client lookup failed:", clientErr.message);
    return NextResponse.json({ error: "Could not load this interview." }, { status: 500 });
  }
  if (!client) return NextResponse.json({ error: "Not a client account" }, { status: 403 });

  if (!hasTranscriptAccess(client)) {
    // 402, and NOTHING about the interview in the body. An unpaid response
    // that leaked "yes, this one has a transcript, 14 minutes long" would be
    // selling a preview of the thing we are charging for.
    return NextResponse.json(
      { error: "Transcript access required.", needsSubscription: true },
      { status: 402 }
    );
  }

  const { data: interview, error } = await db
    .from("ai_interviews")
    .select(SHAREABLE_SCORECARD_COLUMNS)
    .eq("candidate_id", candidateId)
    .eq("kind", "skills")
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[transcripts] interview read failed:", error.message);
    return NextResponse.json({ error: "Could not load this interview." }, { status: 500 });
  }
  if (!interview) {
    // A real answer, not a 404: most candidates have no interview on file, and
    // a paying client is owed the difference between "nothing here" and
    // "something went wrong".
    return NextResponse.json({ interview: null, reason: "no_interview" });
  }

  const row = interview as unknown as Record<string, unknown>;
  return NextResponse.json({
    interview: {
      ...row,
      transcript: normaliseTranscript(row.transcript),
    },
  });
}
