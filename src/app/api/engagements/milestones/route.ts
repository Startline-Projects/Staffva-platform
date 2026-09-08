import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { notifyClient } from "@/lib/notifyClient";
import { maskContact } from "@/lib/contactMask";
import { sendEmail } from "@/lib/email";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/engagements/milestones
 *
 * Actions on milestones:
 * - mark_complete: Candidate marks a milestone as complete. Two different
 *   clocks start, and they are not the same deadline: the DISPUTE window
 *   closes 48 hours later (api/disputes/file), while AUTO-RELEASE fires at
 *   7 days (api/escrow/auto-release). Copy written against this must not
 *   merge them.
 * - approve: Client approves and releases funds immediately
 */
export async function POST(request: Request) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { milestoneId, action } = await request.json();
    const role = user.app_metadata?.role;

    if (!milestoneId || !action) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const admin = getAdminClient();

    const { data: milestone } = await admin
      .from("milestones")
      .select("*, engagements!inner(client_id, candidate_id)")
      .eq("id", milestoneId)
      .single();

    if (!milestone) {
      return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
    }

    const now = new Date();

    // Candidate marks milestone as complete
    if (action === "mark_complete" && role === "candidate") {
      // Verify candidate owns this engagement
      const { data: candidate } = await admin
        .from("candidates")
        .select("id")
        .eq("user_id", user.id)
        .single();

      if (!candidate || candidate.id !== milestone.engagements.candidate_id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }

      if (milestone.status !== "funded") {
        return NextResponse.json({ error: "Milestone must be funded first" }, { status: 400 });
      }

      // Set auto-release to 7 days from now
      const autoRelease = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      await admin
        .from("milestones")
        .update({
          status: "candidate_marked_complete",
          marked_complete_at: now.toISOString(),
          auto_release_at: autoRelease.toISOString(),
        })
        .eq("id", milestoneId);

      // Tell the client. Until now this reached them through NOTHING: a
      // clock started against their money — the milestone releases on its
      // own at auto_release_at — and the only way to find out was to reload
      // the dashboard and notice a changed status. Fail-soft, so a
      // notification problem cannot undo the candidate's action.
      const [{ data: clientRow }, { data: candRow }] = await Promise.all([
        admin
          .from("clients")
          .select("id, email, full_name")
          .eq("id", milestone.engagements.client_id)
          .maybeSingle(),
        admin
          .from("candidates")
          .select("display_name, full_name")
          .eq("id", candidate.id)
          .maybeSingle(),
      ]);
      if (clientRow) {
        // Candidate-editable name: masked before it reaches the bell, which
        // is the platform's own trusted surface.
        const who = maskContact(candRow?.display_name || candRow?.full_name || "Your contractor");
        const amount = Number(milestone.amount_usd).toLocaleString("en-US", {
          minimumFractionDigits: 2,
        });
        // Pinned to UTC like every other date this platform renders: the
        // stored instant is the same either way, but an unpinned string on a
        // non-UTC runtime names a date one day off from the one the cron
        // will actually act on — on the message whose whole job is telling
        // someone when their money moves.
        const releaseOn = autoRelease.toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        });
        await notifyClient(admin, {
          clientId: clientRow.id,
          category: "payment",
          // No mention of disputing, deliberately: the dispute window closes
          // at 48 hours (not the 7 days this date names — the first draft
          // conflated them), and no dispute control exists in the client
          // product at all. Telling someone they may object, on a deadline
          // that has already passed, using a button that does not exist, is
          // three false claims in one sentence. The gap is on record.
          title: "A milestone was marked complete",
          body: `${who} marked "${milestone.title}" ($${amount}) complete. Approve it to release the payment now; if you do nothing it releases automatically on ${releaseOn}.`,
          route: "/team#engagements",
          dedupeKey: `milestone-complete-${milestoneId}`,
        });
        if (clientRow.email) {
          try {
            await sendEmail(
              {
                from: "StaffVA <notifications@staffva.com>",
                to: clientRow.email,
                subject: `A milestone is ready for your approval — $${amount}`,
                html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
                  <h2 style="color:#1C1B1A;">A milestone is ready for your approval</h2>
                  <p style="color:#444;font-size:14px;">Hi ${clientRow.full_name || "there"},</p>
                  <p style="color:#444;font-size:14px;line-height:1.6;">${who} marked <strong>${milestone.title}</strong> ($${amount}) complete.</p>
                  <p style="color:#444;font-size:14px;line-height:1.6;">Approve it to release the payment straight away. If you do nothing, it releases automatically on <strong>${releaseOn}</strong>. If something looks wrong, reply to this email and we'll look into it before the release date.</p>
                  <a href="https://staffva.com/team#engagements" style="display:inline-block;background:#fe6e3e;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px;">Review the milestone</a>
                </div>`,
              },
              { recipientKind: "client", emailType: "milestone_marked_complete" }
            );
          } catch (err) {
            console.error("[milestones] client email failed:", err);
          }
        }
      }

      return NextResponse.json({ success: true, action: "marked_complete" });
    }

    // Client approves milestone — immediate release
    if (action === "approve" && role === "client") {
      const { data: client } = await admin
        .from("clients")
        .select("id")
        .eq("user_id", user.id)
        .single();

      if (!client || client.id !== milestone.engagements.client_id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }

      if (
        milestone.status !== "candidate_marked_complete" &&
        milestone.status !== "funded"
      ) {
        return NextResponse.json({ error: "Milestone not ready for approval" }, { status: 400 });
      }

      // Release via the escrow release API
      const releaseRes = await fetch(
        `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/escrow/release`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Forward the client's session so escrow/release can authenticate
            // the caller (it now requires an authenticated owning client).
            cookie: request.headers.get("cookie") || "",
          },
          body: JSON.stringify({ milestoneId }),
        }
      );

      if (!releaseRes.ok) {
        const err = await releaseRes.json();
        return NextResponse.json({ error: err.error }, { status: 400 });
      }

      return NextResponse.json({ success: true, action: "approved_and_released" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Milestone action error:", error);
    return NextResponse.json({ error: "Failed to process milestone" }, { status: 500 });
  }
}
