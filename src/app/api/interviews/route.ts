import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { interviewAdminClient } from "@/lib/interviewBookingData";

/**
 * GET /api/interviews — the session user's upcoming interviews, either side,
 * enriched with the counterpart's display name (which RLS deliberately
 * doesn't let the browser join for itself). Powers the dashboard cards.
 */
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const admin = interviewAdminClient();

  const [{ data: client }, { data: candidate }] = await Promise.all([
    admin.from("clients").select("id").eq("user_id", user.id).maybeSingle(),
    admin.from("candidates").select("id").eq("user_id", user.id).maybeSingle(),
  ]);

  // A user can hold BOTH a clients and a candidates row — show both sides,
  // resolved per booking, like the detail route does.
  const ors: string[] = [];
  if (client) ors.push(`client_id.eq.${client.id}`);
  if (candidate) ors.push(`candidate_id.eq.${candidate.id}`);
  if (ors.length === 0) return NextResponse.json({ interviews: [] });

  const sinceIso = new Date(Date.now() - 2 * 3600_000).toISOString();
  const { data: rows } = await admin
    .from("interview_bookings")
    .select("id, candidate_id, client_id, starts_at, duration_minutes, status")
    .eq("status", "booked")
    .gte("starts_at", sinceIso)
    .or(ors.join(","))
    .order("starts_at", { ascending: true })
    .limit(10);
  if (!rows?.length) return NextResponse.json({ interviews: [] });

  const viewerIsClientOf = (r: { client_id: string }) => !!client && r.client_id === client.id;
  const counterparts = new Map<string, string>();
  const candidateIds = rows.filter(viewerIsClientOf).map((r) => r.candidate_id);
  const clientIds = rows.filter((r) => !viewerIsClientOf(r)).map((r) => r.client_id);
  if (candidateIds.length) {
    const { data } = await admin
      .from("candidates")
      .select("id, display_name, full_name")
      .in("id", candidateIds);
    for (const c of data || []) counterparts.set(c.id, c.display_name || c.full_name || "Candidate");
  }
  if (clientIds.length) {
    const { data } = await admin
      .from("clients")
      .select("id, full_name, company_name")
      .in("id", clientIds);
    for (const c of data || []) counterparts.set(c.id, c.company_name || c.full_name || "Client");
  }

  return NextResponse.json({
    interviews: rows.map((r) => {
      const asClient = viewerIsClientOf(r);
      return {
        id: r.id,
        startsAt: r.starts_at,
        durationMinutes: r.duration_minutes || 30,
        counterpartName:
          counterparts.get(asClient ? r.candidate_id : r.client_id) || (asClient ? "Candidate" : "Client"),
      };
    }),
  });
}
