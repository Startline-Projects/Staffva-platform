import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { notifyCandidate } from "@/lib/notifyCandidate";
import { sendEmail } from "@/lib/email";
import { PAUSE_AUTO_END_DAYS } from "@/lib/engagementLifecycle";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}


/**
 * Pause / resume — the contract clause added in the same commit: "Either
 * party may pause this engagement through the StaffVA platform. While
 * paused, no new payment periods accrue… The pausing party may resume the
 * engagement at any time. If the engagement remains paused for thirty (30)
 * consecutive days, this Agreement terminates as though notice had been
 * given and the notice period completed."
 *
 * Only the PAUSER may resume: letting the other side resume would let one
 * party undo the other's decision in a loop. The other side's protections
 * are the 30-day auto-end and the notice route, which stays available while
 * paused. Like notice, this is the signed agreement's mechanism — it
 * requires a fully-executed contract.
 */
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const role = user.app_metadata?.role;
  if (role !== "client" && role !== "candidate") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { action, engagementId } = body as { action?: string; engagementId?: string };
  if (!engagementId || !/^[0-9a-f-]{36}$/i.test(engagementId)) {
    return NextResponse.json({ error: "engagementId required" }, { status: 400 });
  }
  if (action !== "pause" && action !== "resume") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const db = admin();
  const { data: engagement } = await db
    .from("engagements")
    .select("id, client_id, candidate_id, status, paused_at, paused_by, ends_at")
    .eq("id", engagementId)
    .maybeSingle();
  if (!engagement) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });

  if (role === "client") {
    const { data: client } = await db.from("clients").select("id").eq("user_id", user.id).maybeSingle();
    if (!client || client.id !== engagement.client_id) {
      return NextResponse.json({ error: "Not your engagement" }, { status: 403 });
    }
  } else {
    const { data: candidate } = await db.from("candidates").select("id").eq("user_id", user.id).maybeSingle();
    if (!candidate || candidate.id !== engagement.candidate_id) {
      return NextResponse.json({ error: "Not your engagement" }, { status: 403 });
    }
  }

  if (engagement.status !== "active") {
    return NextResponse.json({ error: "This engagement has already ended." }, { status: 409 });
  }

  const { data: executed } = await db
    .from("engagement_contracts")
    .select("id")
    .eq("engagement_id", engagementId)
    .eq("status", "fully_executed")
    .limit(1)
    .maybeSingle();
  if (!executed) {
    return NextResponse.json(
      { error: "Pausing comes from the signed agreement, and this engagement doesn't have one yet." },
      { status: 409 }
    );
  }

  if (action === "pause") {
    // Notice and pause are contradictory promises: notice says "work and pay
    // continue until the end date", pause says work stops now. Once the
    // 14-day clock is running, the engagement rides it out.
    if (engagement.ends_at) {
      return NextResponse.json(
        { error: "Notice has been given — the engagement ends on its notice date and can't be paused." },
        { status: 409 }
      );
    }
    const { data: paused } = await db
      .from("engagements")
      .update({ paused_at: new Date().toISOString(), paused_by: role })
      .eq("id", engagementId)
      .eq("status", "active")
      .is("paused_at", null)
      .select("paused_at")
      .maybeSingle();
    if (!paused) {
      return NextResponse.json({ error: "This engagement is already paused." }, { status: 409 });
    }

    const autoEnd = new Date(
      new Date(paused.paused_at).getTime() + PAUSE_AUTO_END_DAYS * 24 * 3600 * 1000
    ).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

    if (role === "client") {
      await notifyCandidate(db, {
        candidateId: engagement.candidate_id,
        category: "contract",
        title: "The client paused your engagement",
        body: `Work and new payment periods stop while it's paused. If it isn't resumed by ${autoEnd}, it ends automatically. You can give 14 days' notice at any time.`,
        route: "/candidate/contracts",
        dedupeKey: `paused-${engagementId}-${paused.paused_at}`,
      });
    } else {
      const { data: client } = await db.from("clients").select("email").eq("id", engagement.client_id).maybeSingle();
      if (client?.email) {
        try {
          await sendEmail({
            from: "StaffVA <notifications@staffva.com>",
            to: client.email,
            subject: "Your contractor paused the engagement",
            html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
              <h2 style="color:#1C1B1A;">Engagement paused</h2>
              <p style="color:#444;font-size:14px;">Your contractor paused the engagement under the agreement's pause clause. No new payment periods accrue while paused. If it isn't resumed by <strong>${autoEnd}</strong>, it ends automatically. You can give 14 days' notice at any time.</p>
            </div>`,
          }, { recipientKind: "client", emailType: "engagement_paused" });
        } catch { /* the team page shows the paused state regardless */ }
      }
    }
    return NextResponse.json({ paused: true });
  }

  // resume — the pauser only
  if (engagement.paused_at == null) {
    return NextResponse.json({ error: "This engagement isn't paused." }, { status: 409 });
  }
  if (engagement.paused_by !== role) {
    return NextResponse.json(
      { error: "Only the side that paused can resume. You can give 14 days' notice at any time." },
      { status: 409 }
    );
  }
  const { data: resumed } = await db
    .from("engagements")
    .update({ paused_at: null, paused_by: null, last_resumed_at: new Date().toISOString() })
    .eq("id", engagementId)
    .eq("status", "active")
    .eq("paused_by", role)
    .not("paused_at", "is", null)
    .select("id")
    .maybeSingle();
  if (!resumed) {
    return NextResponse.json({ error: "This engagement isn't paused." }, { status: 409 });
  }

  if (role === "client") {
    await notifyCandidate(db, {
      candidateId: engagement.candidate_id,
      category: "contract",
      title: "Your engagement has resumed",
      body: "The pause is over — work and payment periods continue as before.",
      route: "/candidate/contracts",
    });
  } else {
    const { data: client } = await db.from("clients").select("email").eq("id", engagement.client_id).maybeSingle();
    if (client?.email) {
      try {
        await sendEmail({
          from: "StaffVA <notifications@staffva.com>",
          to: client.email,
          subject: "Your contractor resumed the engagement",
          html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
            <h2 style="color:#1C1B1A;">Engagement resumed</h2>
            <p style="color:#444;font-size:14px;">The pause is over — work and payment periods continue as before.</p>
          </div>`,
        }, { recipientKind: "client", emailType: "engagement_resumed" });
      } catch { /* the team page shows the state regardless */ }
    }
  }
  return NextResponse.json({ paused: false });
}
