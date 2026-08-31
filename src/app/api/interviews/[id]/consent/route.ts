import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { interviewAdminClient } from "@/lib/interviewBookingData";

/**
 * POST /api/interviews/[id]/consent — the viewer agrees to the recording.
 *
 * Each party consents for themselves, once; the join route refuses to hand
 * out a token until the viewer's own consent is stamped, so the recording
 * only ever captures people who agreed to be on it.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const admin = interviewAdminClient();
  const { data: b } = await admin
    .from("interview_bookings")
    .select("id, candidate_id, client_id, status")
    .eq("id", id)
    .single();
  if (!b) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (b.status !== "booked") {
    return NextResponse.json({ error: "This interview is no longer active." }, { status: 409 });
  }

  const [{ data: cand }, { data: cl }] = await Promise.all([
    admin.from("candidates").select("user_id").eq("id", b.candidate_id).single(),
    admin.from("clients").select("user_id").eq("id", b.client_id).single(),
  ]);

  const column =
    cl?.user_id === user.id
      ? "client_consented_at"
      : cand?.user_id === user.id
        ? "candidate_consented_at"
        : null;
  if (!column) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const consentedAt = new Date().toISOString();
  const { error } = await admin
    .from("interview_bookings")
    .update({ [column]: consentedAt })
    .eq("id", id)
    .is(column, null); // first stamp wins; re-consent is a no-op, not a rewrite

  if (error) return NextResponse.json({ error: "Could not save — try again." }, { status: 500 });
  return NextResponse.json({ consentedAt });
}
