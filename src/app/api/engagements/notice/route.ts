import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { notifyCandidate } from "@/lib/notifyCandidate";
import { sendEmail } from "@/lib/email";
import { NOTICE_DAYS } from "@/lib/engagementLifecycle";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}


/**
 * "Either party may terminate this Agreement with 14 days' written notice
 * delivered through the StaffVA platform." — section 3 of every signed
 * agreement. This route IS that delivery: the notice is recorded on the
 * engagement, the other party is told the same minute, work and pay continue
 * through the period, and the completion cron ends the engagement at the
 * date. Escrow follows its normal release policies, exactly as the clause
 * says.
 *
 * Available only where a FULLY-EXECUTED contract exists — this is the
 * contract's own mechanism, and an engagement nobody signed has no 14-day
 * clause to execute. (The four legacy unsigned engagements keep the
 * client-release path; their real terms are the standing step-16 question.)
 *
 * A period FUNDED before notice that spans past the end date stays funded at
 * its full amount: the client funded that span knowingly, partial-refund
 * machinery doesn't exist, and the dispute flow covers genuine disagreement.
 * (Pending periods re-clamp at funding time; new periods clamp at creation.)
 *
 * No withdrawal path, deliberately: the agreement defines none, and a
 * "cancel notice" button would let one party repeatedly start and stop the
 * other's countdown. The confirmation dialog carries that warning.
 */
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const engagementId = typeof body.engagementId === "string" ? body.engagementId : "";
  if (!/^[0-9a-f-]{36}$/i.test(engagementId)) {
    return NextResponse.json({ error: "engagementId required" }, { status: 400 });
  }

  const db = admin();
  const role = user.app_metadata?.role;
  if (role !== "client" && role !== "candidate") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: engagement } = await db
    .from("engagements")
    .select("id, client_id, candidate_id, status, notice_given_at")
    .eq("id", engagementId)
    .maybeSingle();
  if (!engagement) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });

  // The caller must BE a party — checked against their own row, not the body.
  if (role === "client") {
    const { data: client } = await db
      .from("clients").select("id").eq("user_id", user.id).maybeSingle();
    if (!client || client.id !== engagement.client_id) {
      return NextResponse.json({ error: "Not your engagement" }, { status: 403 });
    }
  } else {
    const { data: candidate } = await db
      .from("candidates").select("id").eq("user_id", user.id).maybeSingle();
    if (!candidate || candidate.id !== engagement.candidate_id) {
      return NextResponse.json({ error: "Not your engagement" }, { status: 403 });
    }
  }

  if (engagement.status !== "active") {
    return NextResponse.json({ error: "This engagement has already ended." }, { status: 409 });
  }
  if (engagement.notice_given_at) {
    return NextResponse.json(
      { error: "Notice has already been given on this engagement." },
      { status: 409 }
    );
  }

  // The clause belongs to a signed agreement.
  const { data: executed } = await db
    .from("engagement_contracts")
    .select("id")
    .eq("engagement_id", engagementId)
    .eq("status", "fully_executed")
    .limit(1)
    .maybeSingle();
  if (!executed) {
    return NextResponse.json(
      { error: "The 14-day notice mechanism comes from the signed agreement, and this engagement doesn't have one yet." },
      { status: 409 }
    );
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + NOTICE_DAYS * 24 * 3600 * 1000);

  // CAS on "no notice yet, still active" — two tabs cannot restart the clock.
  const { data: recorded } = await db
    .from("engagements")
    .update({
      notice_given_at: now.toISOString(),
      notice_given_by: role,
      ends_at: endsAt.toISOString(),
    })
    .eq("id", engagementId)
    .eq("status", "active")
    .is("notice_given_at", null)
    .select("id")
    .maybeSingle();
  if (!recorded) {
    return NextResponse.json(
      { error: "Notice has already been given on this engagement." },
      { status: 409 }
    );
  }

  const endsLabel = endsAt.toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });

  // Tell the OTHER party the same minute the notice lands.
  if (role === "client") {
    await notifyCandidate(db, {
      candidateId: engagement.candidate_id,
      category: "contract",
      title: "The client has given 14 days' notice",
      body: `Your engagement ends ${endsLabel}. Work and pay continue until then, and money already in escrow follows the normal release process.`,
      route: "/candidate/contracts",
      dedupeKey: `notice-${engagementId}`,
    });
  } else {
    const { data: client } = await db
      .from("clients")
      .select("email, full_name, company_name")
      .eq("id", engagement.client_id)
      .maybeSingle();
    if (client?.email) {
      try {
        await sendEmail({
          from: "StaffVA <notifications@staffva.com>",
          to: client.email,
          subject: "Your contractor has given 14 days' notice",
          html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
            <h2 style="color:#1C1B1A;">14 days' notice</h2>
            <p style="color:#444;font-size:14px;">Your contractor has ended your engagement under the agreement's termination clause. It ends on <strong>${endsLabel}</strong>.</p>
            <p style="color:#444;font-size:14px;">Work and payment continue through the notice period. Funds in escrow follow the normal release process.</p>
          </div>`,
        }, { recipientKind: "client", emailType: "engagement_notice" });
      } catch (err) {
        // A legally significant countdown just started and the client's only
        // push channel failed — that goes where the failure query looks.
        await db.from("vendor_failures").insert({
          app: "platform",
          vendor: "resend",
          operation: "email.engagement_notice",
          fatal: false,
          message: (err instanceof Error ? err.message : String(err)).slice(0, 2000),
          context: { engagementId },
        });
      }
    }
  }

  return NextResponse.json({ endsAt: endsAt.toISOString() });
}
