import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { interviewAdminClient } from "@/lib/interviewBookingData";

/**
 * GET /api/interviews/[id] — one booking, enriched for whichever party is
 * asking. RLS lets each party read the booking row itself, but the
 * counterpart's display name and timezone live in tables they can't read —
 * so the route verifies membership first, then enriches with the service
 * client and returns only display-safe fields (no emails).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const admin = interviewAdminClient();
  const { data: b } = await admin
    .from("interview_bookings")
    .select("id, candidate_id, client_id, starts_at, duration_minutes, status, cancelled_at")
    .eq("id", id)
    .single();
  if (!b) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [{ data: cand }, { data: cl }] = await Promise.all([
    admin
      .from("candidates")
      .select("user_id, display_name, full_name, time_zone")
      .eq("id", b.candidate_id)
      .single(),
    admin.from("clients").select("user_id, full_name, company_name").eq("id", b.client_id).single(),
  ]);

  const viewerRole =
    cl?.user_id === user.id ? "client" : cand?.user_id === user.id ? "candidate" : null;
  if (!viewerRole) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const counterpart =
    viewerRole === "client"
      ? {
          name: cand?.display_name || cand?.full_name || "Candidate",
          company: null as string | null,
          tz: cand?.time_zone || "UTC",
        }
      : {
          name: cl?.full_name || "Client",
          company: cl?.company_name || null,
          tz: null as string | null,
        };

  return NextResponse.json({
    booking: {
      id: b.id,
      startsAt: b.starts_at,
      durationMinutes: b.duration_minutes || 30,
      status: b.status,
      cancelledAt: b.cancelled_at,
    },
    viewerRole,
    counterpart,
    candidatePath: viewerRole === "client" ? `/candidate/${b.candidate_id}` : null,
  });
}
