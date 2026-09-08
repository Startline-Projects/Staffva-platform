import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { rolePatternsFor } from "@/lib/roleTaxonomy";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * The client dashboard (Atlas steps 5 and 14), derived.
 *
 * Atlas ships two dashboards — one for an account that cannot yet fund, one
 * for an account that can — and hard-codes every number on both: "2,847
 * candidates", "12% vs Dec", "Avg approval time 2 days", rehire percentages,
 * star ratings for people who have never been reviewed. None of that is
 * here. Every figure below is computed from rows this database holds, and
 * where a figure cannot be computed the surface it belonged to is absent
 * rather than invented.
 *
 * No event store is involved: "needs your attention" and "recent activity"
 * are assembled from the timestamps the domain tables already carry, the
 * same way the candidate dashboard does it.
 */

interface AttentionRow {
  kind: string;
  title: string;
  detail: string;
  cta: string;
  href: string;
  /** Sort key — soonest deadline or oldest wait first. */
  at: string | null;
  severity: "contract" | "urgent" | "warm" | "calm";
}

export async function GET() {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.app_metadata?.role !== "client") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const admin = getAdminClient();
    const { data: client } = await admin
      .from("clients")
      .select("id, full_name")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const clientId = client.id;
    const firstName = (client.full_name || "").trim().split(/\s+/)[0] || "there";

    // Gate state and signup intent come from columns added by migrations
    // 00222/00221, read separately and tolerantly: a dashboard must not 500
    // because a migration has not landed yet (the step-4 lesson). Unreadable
    // means "treat as not-yet-verified", which shows the explore dashboard —
    // the safe direction, since the funding gate itself lives server-side.
    let verified = false;
    let hiringFor: string[] = [];
    const { data: gate } = await admin
      .from("clients")
      .select("id_verification_status, payment_method_id, hiring_for")
      .eq("id", clientId)
      .maybeSingle();
    if (gate) {
      verified = gate.id_verification_status === "passed" && !!gate.payment_method_id;
      hiringFor = Array.isArray(gate.hiring_for) ? gate.hiring_for : [];
    }

    const nowIso = new Date().toISOString();

    // ── Engagements, the spine of the verified view ──────────────────────────
    const { data: engagements } = await admin
      .from("engagements")
      .select(
        "id, candidate_id, status, created_at, client_total_usd, candidate_rate_usd, weekly_hours, paused_at, ends_at, candidates(display_name, role_category, profile_photo_url)"
      )
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });

    const activeEngagements = (engagements || []).filter((e) => e.status === "active");
    const engagementIds = (engagements || []).map((e) => e.id);
    // Money that still needs a decision belongs to LIVE engagements only.
    // Keyed on every engagement, a period left unfunded on a hire that ended
    // months ago would sit in the attention queue permanently, with nothing
    // on the page able to clear it.
    const activeEngagementIds = activeEngagements.map((e) => e.id);

    // ── The attention queue ─────────────────────────────────────────────────
    const attention: AttentionRow[] = [];

    // Counters waiting on this client.
    //
    // Two corrections review made here. There is no updated_at on this table
    // (created_at / sent_at / viewed_at / responded_at only) — selecting it
    // made PostgREST 42703, which this code would have swallowed into "you
    // have nothing waiting". And 'countered' does not mean "your turn": a
    // counter sets that status whoever sent it. current_round parity is the
    // turn, exactly as api/offers/negotiate computes it — odd means the
    // candidate proposed last, so it is the client's move.
    const { data: liveOffers } = await admin
      .from("engagement_offers")
      .select(
        "id, candidate_id, status, current_round, sent_at, hourly_rate, hours_per_week, candidates(display_name)"
      )
      .eq("client_id", clientId)
      .in("status", ["sent", "viewed", "countered"]);
    const openOffers = (liveOffers || []).filter(
      (o) => o.status === "countered" && Number(o.current_round ?? 0) % 2 === 1
    );
    for (const o of openOffers || []) {
      const cand = (o.candidates as { display_name?: string } | null)?.display_name;
      attention.push({
        kind: "counter",
        title: "A counter needs your answer",
        detail: `${cand || "A candidate"} · $${Number(o.hourly_rate)}/hr · ${o.hours_per_week} hrs/week`,
        cta: "Open negotiation",
        href: "/team#offers",
        at: o.sent_at,
        severity: "urgent",
      });
    }

    // Contracts waiting on this client's signature.
    const { data: pendingContracts } = await admin
      .from("engagement_contracts")
      .select("id, created_at, engagement_id, candidates(display_name)")
      .eq("client_id", clientId)
      .eq("status", "pending_client");
    for (const c of pendingContracts || []) {
      const cand = (c.candidates as { display_name?: string } | null)?.display_name;
      attention.push({
        kind: "contract",
        title: "A contract is waiting for your signature",
        detail: `${cand || "A candidate"} accepted — the agreement is drafted`,
        cta: "Review and sign",
        href: "/team#engagements",
        at: c.created_at,
        severity: "contract",
      });
    }

    // Money the client is being asked to move. Both of these are only
    // actionable once verification and a card are in place, which is exactly
    // what the banner elsewhere prompts for.
    if (activeEngagementIds.length > 0) {
      const [{ data: duePeriods }, { data: dueMilestones }] = await Promise.all([
        admin
          .from("payment_periods")
          .select("id, engagement_id, amount_usd, period_start, period_end, status")
          .in("engagement_id", activeEngagementIds)
          .eq("status", "pending"),
        admin
          .from("milestones")
          .select("id, engagement_id, title, amount_usd, status, auto_release_at")
          .in("engagement_id", activeEngagementIds)
          .eq("status", "candidate_marked_complete"),
      ]);
      for (const p of duePeriods || []) {
        attention.push({
          kind: "fund_period",
          title: "A payment period needs funding",
          detail: `$${Number(p.amount_usd).toFixed(2)} · ${p.period_start} to ${p.period_end}`,
          cta: "Fund it",
          href: "/team#engagements",
          at: p.period_start,
          severity: "warm",
        });
      }
      for (const m of dueMilestones || []) {
        attention.push({
          kind: "approve_milestone",
          title: "A milestone is waiting for your approval",
          detail: m.auto_release_at
            ? `${m.title} · $${Number(m.amount_usd).toFixed(2)} · releases on its own ${new Date(
                m.auto_release_at
              ).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`
            : `${m.title} · $${Number(m.amount_usd).toFixed(2)}`,
          cta: "Review it",
          href: "/team#engagements",
          at: m.auto_release_at,
          severity: "urgent",
        });
      }
    }

    // Interviews already on the calendar.
    const { data: upcomingInterviews } = await admin
      .from("interview_bookings")
      .select("id, starts_at, candidate_id, candidates(display_name)")
      .eq("client_id", clientId)
      .eq("status", "booked")
      .gte("starts_at", nowIso)
      .order("starts_at", { ascending: true })
      .limit(5);
    for (const iv of upcomingInterviews || []) {
      const cand = (iv.candidates as { display_name?: string } | null)?.display_name;
      attention.push({
        kind: "interview",
        title: "Interview scheduled",
        detail: `${cand || "A candidate"} · ${new Date(iv.starts_at).toLocaleString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: "UTC",
        })} UTC`,
        cta: "View",
        href: `/interviews/${iv.id}`,
        at: iv.starts_at,
        severity: "calm",
      });
    }

    // Soonest / oldest first. Rows with no date sort last rather than
    // pretending to a position they haven't earned.
    attention.sort((a, b) => {
      if (!a.at) return 1;
      if (!b.at) return -1;
      return a.at.localeCompare(b.at);
    });

    // ── Spend, from the fee columns the engagements already carry ───────────
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    let spentThisMonth = 0;
    let heldInEscrow = 0;
    if (engagementIds.length > 0) {
      const [{ data: periods }, { data: milestones }] = await Promise.all([
        admin
          .from("payment_periods")
          .select("amount_usd, status, funded_at")
          .in("engagement_id", engagementIds),
        admin
          .from("milestones")
          .select("amount_usd, status, funded_at")
          .in("engagement_id", engagementIds),
      ]);
      // "Held" must mean the same thing here as on the escrow panel further
      // down the same page: money paid in and not yet released. A milestone
      // marked complete, or one under dispute, is still held — counting only
      // 'funded' showed $0 on the dashboard beside the same $500 listed as
      // held 600px below.
      const HELD = new Set(["funded", "candidate_marked_complete", "approved", "disputed"]);
      for (const row of [...(periods || []), ...(milestones || [])]) {
        const amount = Number(row.amount_usd) || 0;
        if (row.funded_at && new Date(row.funded_at) >= monthStart) spentThisMonth += amount;
        if (HELD.has(row.status)) heldInEscrow += amount;
      }
    }
    // What the running engagements already agreed to, month over month —
    // client_total_usd is the monthly figure written at acceptance (rate ×
    // hours × the platform's own 4.33 weeks constant, plus the fee).
    //
    // Excluded: paused engagements (no periods accrue while paused) AND
    // engagements under notice, which stop at ends_at. The first draft named
    // only the pause, which implied a recurring figure for a hire the client
    // had already ended.
    const recurringEngagements = activeEngagements.filter((e) => !e.paused_at && !e.ends_at);
    const monthlyForecast = recurringEngagements.reduce(
      (sum, e) => sum + (Number(e.client_total_usd) || 0),
      0
    );

    // ── Recent activity, assembled from real timestamps ──────────────────────
    const recent: { text: string; at: string; href: string }[] = [];
    const { data: recentOffers } = await admin
      .from("engagement_offers")
      .select("id, candidate_id, status, sent_at, responded_at, candidates(display_name)")
      .eq("client_id", clientId)
      // Drafts have a null sent_at, and Postgres sorts NULLs FIRST on DESC —
      // they would occupy the whole window and then be skipped, emptying the
      // feed for a client who has sent plenty.
      .not("sent_at", "is", null)
      .order("sent_at", { ascending: false, nullsFirst: false })
      .limit(8);
    const acceptedCandidateIds = new Set<string>();
    for (const o of recentOffers || []) {
      const who = (o.candidates as { display_name?: string } | null)?.display_name || "A candidate";
      if (o.responded_at && (o.status === "accepted" || o.status === "declined")) {
        if (o.status === "accepted" && o.candidate_id) acceptedCandidateIds.add(o.candidate_id);
        recent.push({
          text: `${who} ${o.status} your proposal.`,
          at: o.responded_at,
          href: "/team#offers",
        });
      } else if (o.sent_at) {
        recent.push({ text: `You sent ${who} a proposal.`, at: o.sent_at, href: "/team#offers" });
      }
    }
    for (const e of engagements || []) {
      const who = (e.candidates as { display_name?: string } | null)?.display_name || "A candidate";
      // An acceptance and the engagement it creates happen in the same
      // breath; reporting both put the same event on two adjacent lines and
      // pushed real events out of a six-row feed.
      if (e.created_at && !acceptedCandidateIds.has(e.candidate_id)) {
        recent.push({
          text: `Engagement with ${who} started.`,
          at: e.created_at,
          href: "/team#engagements",
        });
      }
    }
    recent.sort((a, b) => b.at.localeCompare(a.at));

    // ── The explore state's own numbers ─────────────────────────────────────
    // The real, current pool — not Atlas's "2,847". If it is small, it says
    // the small number.
    const { count: poolCount } = await admin
      .from("matchable_candidates")
      .select("id", { count: "exact", head: true });

    // Suggestions come from the signup chips, matched through roleTaxonomy —
    // the same mapping /browse uses, so "based on what you're hiring for"
    // means the same thing here as a browse filter does. No AI call: this
    // must work whether or not the model vendor is reachable.
    const suggestionSelect =
      "id, display_name, country, role_category, hourly_rate, profile_photo_url, availability_status";
    // Ordered, so the sample is at least stable between loads rather than
    // whatever Postgres hands back. The cap is far above today's pool; if it
    // is ever reached, targeting is decided over the newest 500 and the
    // heading falls back to the neutral one rather than claiming a match it
    // did not look for.
    const { data: pool } = await admin
      .from("matchable_candidates")
      .select(suggestionSelect)
      .order("created_at", { ascending: false })
      .limit(500);

    // Matching happens in JS rather than in a PostgREST `or=`: role names
    // include values like "Sales Development Representative (SDR)", and
    // parentheses and commas are structural characters in that filter
    // syntax. The matchable pool is small enough that this is cheaper than
    // getting the quoting subtly wrong.
    const patterns = hiringFor.flatMap((label) => rolePatternsFor(label));
    const matches = (row: { role_category?: string | null }) => {
      const role = (row.role_category || "").toLowerCase();
      return patterns.some((p) => {
        const needle = p.replace(/%/g, "").toLowerCase();
        if (!needle) return false;
        return p.includes("%") ? role.includes(needle) : role === needle;
      });
    };
    const preferred = patterns.length > 0 ? (pool || []).filter(matches) : [];
    // Fall back to the pool itself when the chips match nobody — an empty
    // "suggested for you" strip would read as "we have no one", which is a
    // different and untrue claim. The heading says which of the two it is.
    const suggestions = (preferred.length > 0 ? preferred : pool || []).slice(0, 8);
    const suggestionsAreTargeted = preferred.length > 0;

    // Activity counters for the explore state — each one a real count.
    // saved_candidates is not queried: nothing in the product writes it, so
    // the card it fed could only ever be 0. It returns with shortlists.
    const [{ data: convoRows }, { count: jobPosts }] = await Promise.all([
      // Distinct counterparties, so this cannot be a head-count. Bounded
      // rather than unbounded: pulling every message a client ever sent to
      // compute one integer is the kind of query that is fine at 3 rows and
      // ruinous at 5,000.
      admin.from("messages").select("candidate_id").eq("client_id", clientId).limit(2000),
      admin
        .from("job_posts")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientId),
    ]);

    return NextResponse.json({
      verified,
      firstName,
      hiringFor,
      attention,
      quickStats: {
        // Things that need a DECISION. A booked interview is on the list so
        // the client can see it coming, but it is not a chore — counting it
        // told someone with three interviews and no obligations that three
        // things needed their attention.
        todo: attention.filter((a) => a.severity !== "calm").length,
        // Distinct CANDIDATES in flight: an open proposal or a booked
        // interview, minus anyone already an active hire (they are counted
        // in the next number, and a person should not appear in two).
        // The first draft keyed the Set on a constant string, so every open
        // offer collapsed into one.
        inPipeline: (() => {
          const activeCandidateIds = new Set(activeEngagements.map((e) => e.candidate_id));
          const inFlight = new Set<string>();
          for (const o of liveOffers || []) {
            if (o.candidate_id && !activeCandidateIds.has(o.candidate_id)) inFlight.add(o.candidate_id);
          }
          for (const i of upcomingInterviews || []) {
            if (i.candidate_id && !activeCandidateIds.has(i.candidate_id)) inFlight.add(i.candidate_id);
          }
          return inFlight.size;
        })(),
        // Paused hires are not active hires. Counting them here while the
        // grid labelled the same person "Paused" gave one page two answers.
        activeHires: activeEngagements.filter((e) => !e.paused_at).length,
      },
      // Live ones only. The grid sits above a full "Active Hires" section on
      // the same page; showing ended engagements here as well made one page
      // present two different lists under two headings that sounded alike.
      engagements: (engagements || [])
        .filter((e) => e.status === "active")
        .slice(0, 6)
        .map((e) => {
        const c = e.candidates as
          | { display_name?: string; role_category?: string; profile_photo_url?: string }
          | null;
        return {
          id: e.id,
          name: c?.display_name || "Candidate",
          role: c?.role_category || null,
          photo: c?.profile_photo_url || null,
          status: e.paused_at ? "paused" : e.ends_at ? "ending" : e.status,
          rate: Number(e.candidate_rate_usd) || null,
          hours: e.weekly_hours || null,
          monthly: Number(e.client_total_usd) || null,
          startedAt: e.created_at,
          endsAt: e.ends_at,
        };
      }),
      spend: {
        monthlyForecast: Math.round(monthlyForecast * 100) / 100,
        spentThisMonth: Math.round(spentThisMonth * 100) / 100,
        heldInEscrow: Math.round(heldInEscrow * 100) / 100,
      },
      recentActivity: recent.slice(0, 6),
      explore: {
        poolCount: poolCount ?? 0,
        suggestions,
        suggestionsAreTargeted,
        activity: {
          conversations: new Set((convoRows || []).map((m) => m.candidate_id)).size,
          upcomingInterviews: (upcomingInterviews || []).length,
          jobPosts: jobPosts ?? 0,
        },
      },
    });
  } catch (error) {
    console.error("[client dashboard]", error);
    return NextResponse.json({ error: "Failed to load dashboard" }, { status: 500 });
  }
}
