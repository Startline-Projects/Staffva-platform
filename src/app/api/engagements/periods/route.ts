import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * POST /api/engagements/periods
 *
 * Creates the next payment period for an ongoing engagement.
 * Called when client clicks "Fund Next Period" in team portal.
 *
 * Body: { engagementId }
 */
export async function POST(request: Request) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.app_metadata?.role !== "client") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { engagementId } = await request.json();

    if (!engagementId) {
      return NextResponse.json({ error: "engagementId required" }, { status: 400 });
    }

    const admin = getAdminClient();

    // Verify engagement belongs to this client and can accrue periods.
    // Ongoing engagements always can. PROJECT engagements can too when they
    // are hourly-basis (payment_cycle null + weekly_hours set) — that is every
    // offer-created fixed-term deal, and before this they were legally
    // executed but unfundable: no periods (this gate excluded them) and no
    // milestone API either. Milestone-style projects (project total in
    // candidate_rate_usd, no weekly_hours) stay excluded — their money moves
    // through milestones.
    const { data: engagement } = await admin
      .from("engagements")
      .select("*, clients!inner(user_id)")
      .eq("id", engagementId)
      .eq("status", "active")
      .single();

    if (!engagement || engagement.clients.user_id !== user.id) {
      return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
    }
    const hourlyBasis = engagement.payment_cycle == null && engagement.weekly_hours != null;
    if (engagement.contract_type !== "ongoing" && !hourlyBasis) {
      return NextResponse.json(
        { error: "This engagement is funded per milestone, not per period." },
        { status: 409 }
      );
    }

    // Get the latest period to determine next period dates
    const { data: latestPeriod } = await admin
      .from("payment_periods")
      .select("*")
      .eq("engagement_id", engagementId)
      .order("period_end", { ascending: false })
      .limit(1)
      .single();

    // One unfunded period at a time: creating another while the current one
    // awaits payment just stacks debt rows the client never asked for.
    if (latestPeriod && !latestPeriod.funded_at) {
      return NextResponse.json(
        { error: "The current period hasn't been funded yet — fund it first.", period: latestPeriod },
        { status: 409 }
      );
    }

    const periodStart = latestPeriod
      ? new Date(latestPeriod.period_end)
      : new Date();

    const periodEnd = new Date(periodStart);

    switch (engagement.payment_cycle) {
      case "weekly":
        periodEnd.setDate(periodEnd.getDate() + 7);
        break;
      case "biweekly":
        periodEnd.setDate(periodEnd.getDate() + 14);
        break;
      case "monthly":
      default:
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        break;
    }

    // A period must not outlive the engagement. When 14 days' notice is
    // running, the final period CLAMPS to ends_at — the clause pays "for all
    // work satisfactorily completed up to the date of termination", not for a
    // month that extends past it. Only hourly-basis engagements can carry a
    // notice (it requires a signed contract, and signing requires hourly
    // terms), so the pro-rate below is always well-defined.
    let periodFraction = 1;
    if (engagement.ends_at) {
      // DATE-truncated (UTC): period_start/period_end are DATE columns, so the
      // clamp, the refusal, and the stored row must all speak in dates. With
      // the raw instant, a period clamped to '09-19' still admitted a
      // follow-up starting 09-19T00:00 < the 14:32 end instant — a zero-day
      // duplicate the client could be charged for.
      const endsDate = new Date(engagement.ends_at.slice(0, 10));
      if (periodStart >= endsDate) {
        return NextResponse.json(
          { error: "This engagement ends before another period would start." },
          { status: 409 }
        );
      }
      if (periodEnd > endsDate) {
        periodFraction =
          (endsDate.getTime() - periodStart.getTime()) /
          (periodEnd.getTime() - periodStart.getTime());
        periodEnd.setTime(endsDate.getTime());
      }
    }

    // WHAT THE CANDIDATE IS OWED FOR THE PERIOD — not candidate_rate_usd raw.
    // candidate_rate_usd is a CYCLE amount on the legacy engagements
    // (payment_cycle set) but an HOURLY rate on every offer-created one
    // (payment_cycle null). Copying it verbatim is the bug the step-18 audit
    // caught: the client funds the real monthly total (client_total_usd) and
    // release then pays the candidate the literal hourly rate — $15 for a
    // month of $2,859 work, the platform silently keeping the rest.
    let periodAmount: number;
    if (engagement.payment_cycle != null) {
      periodAmount = Number(engagement.candidate_rate_usd);
    } else if (engagement.weekly_hours != null) {
      // Hourly basis, monthly period (the switch above defaulted to monthly),
      // pro-rated when the notice clamp shortened it.
      periodAmount =
        Math.round(
          Number(engagement.candidate_rate_usd) * engagement.weekly_hours * 4.33 * periodFraction * 100
        ) / 100;
    } else {
      // No cycle and no hours: the amount is underivable. Refusing beats
      // moving a wrong amount of money — the same rule the contract-signing
      // terms gate applies.
      return NextResponse.json(
        { error: "This engagement's pay terms can't produce a period amount. Our team has been alerted." },
        { status: 409 }
      );
    }

    const { data: newPeriod, error: periodError } = await admin
      .from("payment_periods")
      .insert({
        engagement_id: engagementId,
        period_start: periodStart.toISOString().split("T")[0],
        period_end: periodEnd.toISOString().split("T")[0],
        amount_usd: periodAmount,
      })
      .select()
      .single();

    if (periodError) {
      // unique_violation on (engagement_id, period_start): a concurrent
      // request created the same period a moment ago — hand that one back
      // instead of erroring, so the caller funds it rather than retrying.
      if (periodError.code === "23505") {
        const { data: existing } = await admin
          .from("payment_periods")
          .select("*")
          .eq("engagement_id", engagementId)
          .order("period_end", { ascending: false })
          .limit(1)
          .single();
        return NextResponse.json({ period: existing }, { status: 200 });
      }
      return NextResponse.json({ error: periodError.message }, { status: 500 });
    }

    return NextResponse.json({ period: newPeriod });
  } catch (error) {
    console.error("Create period error:", error);
    return NextResponse.json({ error: "Failed to create period" }, { status: 500 });
  }
}
