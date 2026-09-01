import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * POST /api/proctor/session/[id]/end — the capture is over; queue the
 * session for AI review. Body may carry { attemptId, cameraLostCount } to
 * bind the recording to the server-held test attempt it covered.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { attemptId?: unknown; cameraLostCount?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: session } = await admin
    .from("proctor_sessions")
    .select("id, review_status, candidates!inner(user_id)")
    .eq("id", id)
    .single();
  const owner = (session?.candidates as { user_id?: string } | null)?.user_id;
  if (!session || owner !== user.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (session.review_status !== "recording") return NextResponse.json({ ok: true });

  await admin
    .from("proctor_sessions")
    .update({
      review_status: "pending_review",
      ended_at: new Date().toISOString(),
      ...(typeof body.attemptId === "string" ? { attempt_id: body.attemptId } : {}),
      ...(typeof body.cameraLostCount === "number" && body.cameraLostCount >= 0
        ? { camera_lost_count: Math.min(Math.round(body.cameraLostCount), 100) }
        : {}),
    })
    .eq("id", id)
    .eq("review_status", "recording");

  return NextResponse.json({ ok: true });
}
