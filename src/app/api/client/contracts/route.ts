import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { maskContact } from "@/lib/contactMask";
import { NOTICE_DAYS, PAUSE_AUTO_END_DAYS } from "@/lib/engagementLifecycle";
import { signBlockReason } from "@/lib/contractTerms";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * GET /api/client/contracts — the client's agreements and the live state of
 * the engagement each one governs.
 *
 * A contract row and its engagement answer different questions: the contract
 * says whether it is signed, the engagement says whether the work is running,
 * paused, under notice or over. Atlas's contracts page shows one status pill
 * per card, so the two have to be resolved into a single honest word here
 * rather than in the markup, where the rule would be re-derived per surface.
 *
 * Everything is a column. Atlas's card additionally carries a
 * "CTR-2025-0103-ML" id scheme (no such thing), a "What's next" feed with a
 * scheduled 30-day review (no review cycle exists), an approval-time average,
 * and a downloadable archive. None are built; the omissions are recorded on
 * the page.
 */
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const db = admin();
  const { data: client, error: clientErr } = await db
    .from("clients").select("id").eq("user_id", user.id).maybeSingle();
  if (clientErr) return NextResponse.json({ error: "Could not load your contracts." }, { status: 500 });
  if (!client) return NextResponse.json({ error: "Not a client account" }, { status: 403 });

  const { data: rows, error } = await db
    .from("engagement_contracts")
    .select(
      "id, engagement_id, status, generated_at, client_signed_at, candidate_signed_at, " +
      "contract_pdf_url, candidate_id, " +
      "candidates(id, display_name, role_category, country, profile_photo_url), " +
      "engagements(id, status, candidate_rate_usd, client_total_usd, weekly_hours, contract_type, " +
      "payment_cycle, created_at, paused_at, paused_by, pause_reason, pause_resume_expected, " +
      "pause_note, notice_given_at, notice_given_by, ends_at, last_resumed_at)"
    )
    .eq("client_id", client.id)
    .order("generated_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[client/contracts] read failed:", error.message);
    return NextResponse.json({ error: "Could not load your contracts." }, { status: 500 });
  }

  type Row = {
    id: string;
    engagement_id: string;
    status: string;
    generated_at: string;
    client_signed_at: string | null;
    candidate_signed_at: string | null;
    contract_pdf_url: string | null;
    candidate_id: string;
    candidates: Record<string, unknown> | null;
    engagements: Record<string, unknown> | null;
  };

  const now = Date.now();
  const contracts = ((rows ?? []) as unknown as Row[]).map((r) => {
    const e = r.engagements;
    const c = r.candidates;
    const executed = r.status === "fully_executed";
    const engStatus = (e?.status as string) ?? null;
    const pausedAt = (e?.paused_at as string) ?? null;
    const endsAt = (e?.ends_at as string) ?? null;

    // Signability comes from signBlockReason, which the candidate side
    // already uses — NOT from a second copy of the rule here. Its comment
    // says why in as many words: executability is decided BEFORE whose turn
    // it is, or a contract on an engagement released in April is described as
    // merely "waiting on the other side", which reads as "it's coming" when
    // nobody can ever sign it. Two such contracts are live right now. It also
    // catches terms_conflict, which 409s a client countersignature.
    const block = signBlockReason(
      {
        contractStatus: r.status,
        engagementStatus: engStatus,
        weeklyHours: e?.weekly_hours != null ? Number(e.weekly_hours) : null,
        paymentCycle: (e?.payment_cycle as string) ?? null,
        contractType: (e?.contract_type as string) ?? null,
      },
      "client"
    );
    // Null means the CLIENT can sign it right now.
    const waitingOn: "client" | "candidate" | null =
      block === null ? "client" : executed ? null : r.status === "pending_candidate" ? "candidate" : null;

    // ONE word per card, resolved from both records. Order matters: a
    // payment_failed engagement is still LIVE — the auto-end cron treats it
    // as such — so collapsing every non-active status into "ended" told a
    // client whose card merely declined that their contract was over.
    const ended = engStatus === "released" || engStatus === "completed";
    const state = ended
      ? "ended"
      : !executed
        ? block === "terms_conflict"
          ? "blocked"
          : waitingOn === "candidate"
            ? "awaiting_countersign"
            : "awaiting_signature"
        : pausedAt
          ? "paused"
          : endsAt
            ? "ending"
            : "active";

    const autoEndAt = pausedAt
      ? new Date(new Date(pausedAt).getTime() + PAUSE_AUTO_END_DAYS * 86_400_000).toISOString()
      : null;

    return {
      id: r.id,
      engagementId: r.engagement_id,
      contractStatus: r.status,
      state,
      waitingOn,
      // Null when the client can sign. Passed through so the card can say
      // WHY rather than offering a button that 409s.
      blockReason: block,
      paymentFailed: engStatus === "payment_failed",
      generatedAt: r.generated_at,
      clientSignedAt: r.client_signed_at,
      candidateSignedAt: r.candidate_signed_at,
      pdfUrl: r.contract_pdf_url,
      terms: e
        ? {
            // ⚠️ candidate_rate_usd is an HOURLY rate only when payment_cycle
            // is NULL. On the legacy engagements it is a CYCLE amount — the
            // step-18 audit caught release paying "$15" for a month's work
            // because something copied it verbatim. Five of the eight live
            // engagements carry a cycle, so labelling this "/hr" everywhere
            // would misstate the deal on most of them by ~4x. The basis
            // travels with the number and the card labels from it.
            candidateRate: e.candidate_rate_usd != null ? Number(e.candidate_rate_usd) : null,
            // Same rule for the client side: client_total_usd is monthly only
            // on the offer path; with a cycle set it is per cycle.
            clientTotal: e.client_total_usd != null ? Number(e.client_total_usd) : null,
            rateBasis: (e.payment_cycle as string) ?? "hourly",
            weeklyHours: e.weekly_hours != null ? Number(e.weekly_hours) : null,
            contractType: (e.contract_type as string) ?? null,
            paymentCycle: (e.payment_cycle as string) ?? null,
            // engagements has NO start-date column. created_at is when the
            // record was made, which is not the agreed start (the one
            // offer-created row was created 7 April for a 14 April start), so
            // it is labelled as what it is.
            createdAt: (e.created_at as string) ?? null,
          }
        : null,
      pause: pausedAt
        ? {
            at: pausedAt,
            by: (e?.paused_by as string) ?? null,
            reason: (e?.pause_reason as string) ?? null,
            // Free text the other party may have written.
            note: e?.pause_note ? maskContact(String(e.pause_note)) : null,
            resumeExpected: (e?.pause_resume_expected as string) ?? null,
            // The only automatic date in a pause, and it ENDS the agreement.
            autoEndAt,
            autoEndDays: PAUSE_AUTO_END_DAYS,
            // Only the side that paused may resume (see /api/engagements/pause).
            canResume: (e?.paused_by as string) === "client",
          }
        : null,
      notice: endsAt
        ? {
            givenAt: (e?.notice_given_at as string) ?? null,
            givenBy: (e?.notice_given_by as string) ?? null,
            endsAt,
            days: NOTICE_DAYS,
            over: new Date(endsAt).getTime() < now,
          }
        : null,
      candidate: c
        ? {
            id: c.id as string,
            displayName: maskContact(String(c.display_name ?? "")) || "Candidate",
            roleCategory: (c.role_category as string) ?? null,
            country: (c.country as string) ?? null,
            photo: (c.profile_photo_url as string) ?? null,
          }
        : null,
    };
  });

  return NextResponse.json({ contracts, truncated: (rows ?? []).length >= 200 });
}
