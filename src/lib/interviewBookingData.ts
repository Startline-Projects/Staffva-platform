import { createClient } from "@supabase/supabase-js";
import type { BookingEmailData } from "@/lib/interviewEmails";

/**
 * Turns a booking id into everything the interview emails need — names,
 * addresses, timezones — via the service client (RLS lets each party see the
 * booking row, but not the other party's email). Server-side only.
 */

export function interviewAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function loadBookingEmailData(bookingId: string): Promise<BookingEmailData | null> {
  const admin = interviewAdminClient();
  const { data: b } = await admin
    .from("interview_bookings")
    .select("id, starts_at, duration_minutes, candidate_id, client_id")
    .eq("id", bookingId)
    .single();
  if (!b) return null;

  const [{ data: cand }, { data: cl }] = await Promise.all([
    admin
      .from("candidates")
      .select("display_name, full_name, email, time_zone")
      .eq("id", b.candidate_id)
      .single(),
    admin.from("clients").select("full_name, company_name, email").eq("id", b.client_id).single(),
  ]);
  if (!cand?.email || !cl?.email) return null;

  return {
    bookingId: b.id,
    startsAt: new Date(b.starts_at),
    durationMinutes: b.duration_minutes || 30,
    candidate: {
      name: cand.display_name || cand.full_name || "your candidate",
      email: cand.email,
      tz: cand.time_zone || "UTC",
    },
    client: {
      name: cl.full_name || "there",
      company: cl.company_name || null,
      email: cl.email,
      tz: null, // clients don't publish a timezone; emails fall back to UTC + the ics localizes
    },
  };
}
