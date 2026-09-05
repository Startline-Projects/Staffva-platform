import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import Asti, { AstiPointChip, AstiProgressRing } from "@/components/landing/Asti";
import LegacyDashboard from "@/app/(main)/candidate/dashboard/LegacyDashboard";
import AtlasLiveHome, { type ActivityItem } from "@/components/candidate/portal/AtlasLiveHome";
import { loadCandidateWork, pendingOffers } from "@/lib/candidateWork";
import { loadCandidateContracts, signableContracts, flaggedContracts } from "@/lib/candidateContracts";
import { loadMyReviewState, openReviews } from "@/lib/reviewState";
import StartInterviewButton from "@/app/candidate/(portal)/dashboard/StartInterviewButton";
import { ResubmitButton, AppealForm, ReapplyButton } from "@/components/candidate/OutcomeActions";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type NodeState = "completed" | "current" | "upcoming" | "waived";

interface PipelineNode {
  id: string;
  label: string;
  state: NodeState;
  xp: number;
  detail?: string;
}

/**
 * The pre-approval candidate dashboard: the Atlas 10-node pipeline tracker,
 * with Asti riding it. Node states derive from the candidate record; the
 * primary CTA hands off to the step's surface (/verify-email now, /apply for
 * everything the step machine still runs — steps 6–11 give nodes their own
 * pages progressively). WhatsApp renders as "waived" until Twilio is
 * configured: showing a step as required before it exists would be a lie,
 * and hiding it would misnumber the pipeline everyone signed up to.
 *
 * XP is DERIVED from completed steps, never stored — no ledger to drift.
 * Approved candidates keep the existing dashboard until the live portal
 * (step 13) replaces it.
 */
export default async function CandidateDashboardPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/candidate/dashboard");
  if (user.app_metadata?.role !== "candidate") redirect("/dashboard");

  const admin = getAdminClient();
  const [{ data: profile }, { data: candidate, error: candidateError }] = await Promise.all([
    admin.from("profiles").select("email_verified, full_name, email, phone_verified_at").eq("id", user.id).maybeSingle(),
    admin.from("candidates").select("id, admin_status, first_name, display_name, full_name, email, id_verification_status, english_mc_score, english_comprehension_score, test_completed_at, ai_interview_passed, ai_interview_completed_at, interview1_passed, interview1_completed_at, voice_recording_1_url, voice_recording_2_url, profile_photo_url, resume_url, tagline, bio, payout_method, retake_available_at, test_lockout_until, permanently_blocked, application_step, id_verification_due_at, rejection_reason, reapply_eligible_at, admin_revision_note, appeal_submitted_at, appeal_decision, appeal_response").eq("user_id", user.id).maybeSingle(),
  ]);

  // A failed lookup must not masquerade as a fresh applicant — a candidate
  // with a record would see step 1 of an application they already finished.
  if (candidateError) {
    throw new Error(`candidate lookup failed: ${candidateError.message}`);
  }

  // Latest graded assessment attempt — the per-part breakdown the Atlas
  // result cards show. Only exists for attempts graded by the step-8 engine.
  let englishParts: Record<string, number | null> | null = null;
  if (candidate && candidate.english_mc_score !== null) {
    const { data: lastAttempt } = await admin
      .from("test_attempts")
      .select("part_scores")
      .eq("candidate_id", candidate.id)
      .eq("status", "graded")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    englishParts = (lastAttempt?.part_scores as Record<string, number | null>) || null;
  }

  // Pre-split skills history — the grandfather signal, read exactly as the
  // interview app reads it (api/auth/verify).
  let hasSkillsHistory = false;
  if (candidate) {
    const { count } = await admin
      .from("ai_interviews")
      .select("*", { count: "exact", head: true })
      .eq("candidate_id", candidate.id)
      .eq("kind", "skills");
    hasSkillsHistory = (count || 0) > 0;
  }

  // Interview retake window (only meaningful after a failed interview).
  let interviewRetakeAt: Date | null = null;
  if (candidate?.admin_status === "ai_interview_failed") {
    // Read the track that actually failed: a candidate who has not passed
    // Interview 1 is waiting on the behavioral cooldown, not the skills one.
    const failedKind =
      candidate.interview1_passed === true ||
      candidate.ai_interview_passed === true ||
      hasSkillsHistory
        ? "skills"
        : "behavioral";
    const { data: attempt } = await admin
      .from("interview_attempts")
      .select("next_retake_available_at")
      .eq("candidate_id", candidate.id)
      .eq("kind", failedKind)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (attempt?.next_retake_available_at) interviewRetakeAt = new Date(attempt.next_retake_available_at);
  }

  // Approved candidates get the live portal, not the application pipeline.
  // This branch returns before any pipeline state is derived — deliberately:
  // the derivation reads english_mc_score, and the reverification reset left
  // 30 of the 31 live candidates on 0, which made the pipeline tell people
  // already working through StaffVA that their application was still being
  // received. LegacyDashboard still renders beneath for the things that ARE
  // live work — contracts, payouts, reputation, profile views — with its own
  // pipeline suppressed for the same reason.
  //
  // The ID banner is gone from here: it is one of the reasons LivePortal
  // derives from computeVisibility(), so it can no longer disagree with the
  // rest of the page about whether someone is actually hidden.
  if (candidate?.admin_status === "approved") {
    const { data: live, error: liveError } = await admin
      .from("candidates")
      .select("id, first_name, display_name, full_name, admin_status, permanently_blocked, id_verification_status, id_verification_due_at, availability_status, availability_date, availability_last_updated_at, created_at, lock_status, hourly_rate, hours_per_week, going_live_ack_at, role_category")
      .eq("id", candidate.id)
      .single();
    // Dropping the portal on a failed read would leave a live candidate on a
    // dashboard with no status and no availability control — the exact screen
    // this step exists to remove — and they would have no way to tell that
    // from "everything is fine". Fail loudly instead.
    if (liveError || !live) {
      throw new Error(`live candidate lookup failed: ${liveError?.message ?? "no row"}`);
    }
    // Same loader the work page uses, so the two surfaces cannot disagree
    // about whether an offer is waiting. A failure here must not silently
    // become "no offers" — that is the one thing this must never get wrong —
    // so loadCandidateWork throws and this page fails loudly.
    const { offers } = await loadCandidateWork(live.id);
    const waiting = pendingOffers(offers).length;
    // Same fail-loud contract as the offers read: a throw takes the page down
    // rather than rendering a confident zero over a contract someone is owed.
    const contracts = await loadCandidateContracts(live.id);
    // Soft by design, unlike the two reads above: loadMyReviewState() returns
    // [] on failure rather than throwing, so a review prompt can go missing but
    // the dashboard carrying this person's offers and contracts cannot.
    const reviewStates = await loadMyReviewState();

    // ── Atlas home data: stats + recent activity, one round of queries ──
    // Server component: "now" is request time by design. The purity rule is
    // written for render functions that re-run client-side.
    // eslint-disable-next-line react-hooks/purity
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const [viewsRes, activeEngRes, noticeRes, unreadRes, clientUnreadRes, recentMsgRes] = await Promise.all([
      // profile_views is one row per client (upsert bumps viewed_at), so this
      // count honestly means "distinct clients who looked in the last week",
      // and the activity feed can only ever say that much — never a per-visit
      // event log, because the upsert destroys the history.
      admin
        .from("profile_views")
        .select("viewed_at", { count: "exact" })
        .eq("candidate_id", live.id)
        .gte("viewed_at", weekAgo)
        .order("viewed_at", { ascending: false })
        .limit(5),
      admin
        .from("engagements")
        .select("id", { count: "exact", head: true })
        .eq("candidate_id", live.id)
        .eq("status", "active"),
      // Any engagement in its notice period — the countdown belongs on the
      // home page, not buried behind the contract detail.
      admin
        .from("engagements")
        .select("id, ends_at, notice_given_by")
        .eq("candidate_id", live.id)
        .eq("status", "active")
        .not("ends_at", "is", null)
        .order("ends_at", { ascending: true })
        .limit(1),
      admin
        .from("recruiter_messages")
        .select("id", { count: "exact", head: true })
        .eq("candidate_id", live.id)
        .eq("sender_role", "recruiter")
        .is("read_at", null),
      // Client messages count toward the same stat — the sidebar badge sums
      // both, and two surfaces disagreeing about whether anything is waiting
      // is the exact drift this page exists to prevent.
      admin
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("candidate_id", live.id)
        .eq("sender_type", "client")
        .is("read_at", null),
      admin
        .from("recruiter_messages")
        .select("created_at")
        .eq("candidate_id", live.id)
        .eq("sender_role", "recruiter")
        .gte("created_at", weekAgo)
        .order("created_at", { ascending: false })
        .limit(3),
    ]);

    const waitingOffers = pendingOffers(offers);
    const activity: ActivityItem[] = [
      ...(viewsRes.data ?? []).map((v) => ({
        kind: "view" as const,
        label: "A client viewed your profile",
        at: v.viewed_at as string,
      })),
      ...(recentMsgRes.data ?? []).map((m) => ({
        kind: "message" as const,
        label: "Your StaffVA team sent you a message",
        at: m.created_at as string,
      })),
      ...waitingOffers
        .filter((o) => o.sent_at && new Date(o.sent_at) >= new Date(weekAgo))
        .map((o) => ({
          kind: "offer" as const,
          label: "A client sent you an offer",
          at: o.sent_at as string,
        })),
    ]
      .sort((a, b) => +new Date(b.at) - +new Date(a.at))
      .slice(0, 6);

    return (
      <>
        <AtlasLiveHome
          candidate={live}
          firstName={
            live.first_name ||
            (live.display_name || live.full_name || "there").split(" ")[0]
          }
          pendingOfferCount={waiting}
          signableContractCount={signableContracts(contracts).length}
          flaggedContractCount={flaggedContracts(contracts).length}
          openReviewCount={openReviews(reviewStates).length}
          views7d={viewsRes.count ?? 0}
          unreadMessages={(unreadRes.count ?? 0) + (clientUnreadRes.count ?? 0)}
          activeEngagements={activeEngRes.count ?? 0}
          noticeEngagement={noticeRes.data?.[0] ?? null}
          activity={activity}
        />
        {/* The operational cards the legacy inventory marked MUST SURVIVE —
            interview hours, specialist thread, upcoming interviews, escrow,
            payout setup (with its focus-refetch), video intro, completeness,
            reputation. The #payouts anchor lives on the payout card itself,
            inside LegacyDashboard. */}
        <LegacyDashboard variant="live" />
      </>
    );
  }

  const firstName =
    candidate?.first_name ||
    (candidate?.display_name || candidate?.full_name || profile?.full_name || "there").split(" ")[0];

  const emailDone = profile?.email_verified === true;
  // The step is only REQUIRED once Twilio is configured — offering a verify
  // button that 503s would be worse than an honest "coming soon".
  const phoneEnabled = !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_VERIFY_SERVICE_SID
  );
  const phoneDone = !!profile?.phone_verified_at;
  // Whether the assessment runs its full 5-part form or MC-only — the card
  // must describe the test the candidate will actually get.
  const assessmentFull = !!process.env.ANTHROPIC_API_KEY;
  const idDone = candidate?.id_verification_status === "passed";
  const englishDone = (candidate?.english_mc_score ?? 0) >= 70 && (candidate?.english_comprehension_score ?? 0) >= 70;
  // The two interviews are separate now (step 9). Interview 1 is
  // behavioral, Interview 2 is the skills exam whose verdict every
  // downstream gate still reads as ai_interview_passed.
  //
  // GRANDFATHERING, and it must match the interview app's rule byte for
  // byte (api/interview/session order gate + api/auth/verify skillsHistory):
  // ANY pre-split skills history counts, not just a pass. A candidate
  // mid-retake on the old single interview never took Interview 1 and never
  // will — telling them to "Start Interview 1" while the interview app
  // routes them into the skills exam is two surfaces disagreeing about
  // which interview the candidate is even sitting.
  const interview1Done =
    candidate?.interview1_passed === true ||
    candidate?.ai_interview_passed === true ||
    hasSkillsHistory;
  const interview2Done = candidate?.ai_interview_passed === true;
  const recordingsDone = !!candidate?.voice_recording_1_url && !!candidate?.voice_recording_2_url;
  const profileDone = !!candidate?.profile_photo_url && !!candidate?.resume_url && !!candidate?.tagline && !!candidate?.bio && !!candidate?.payout_method;
  const status = candidate?.admin_status || "";
  const underReview = ["under_review", "profile_review"].includes(status);
  const actionRequired = ["revision_required", "changes_requested"].includes(status);
  const interviewFailed = status === "ai_interview_failed";
  const terminal = ["rejected", "deactivated", "duplicate_blocked"].includes(status) || candidate?.permanently_blocked === true;

  // English retake + anticheat lockouts — Asti rests, honestly. This is a
  // server component: "render" happens once per request, so reading the
  // clock here is the correct per-request behavior, not a purity bug.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const retakeAt = candidate?.retake_available_at ? new Date(candidate.retake_available_at) : null;
  const anticheatUntil = candidate?.test_lockout_until ? new Date(candidate.test_lockout_until) : null;
  const englishLocked = (!!retakeAt && retakeAt.getTime() > now) || (!!anticheatUntil && anticheatUntil.getTime() > now);
  const interviewLocked = !!interviewRetakeAt && interviewRetakeAt.getTime() > now;
  const lockedOut = englishLocked || interviewLocked;
  const lockedUntil = interviewLocked ? interviewRetakeAt! : (anticheatUntil && anticheatUntil.getTime() > now ? anticheatUntil : retakeAt);

  // Node order mirrors what the /apply machine ACTUALLY runs today
  // (form → English → identity → recordings → profile → interview). The
  // Atlas canonical order arrives as steps 7–11 rebuild those flows.
  // ID verification sits AFTER the assessments (owner's rule, 2026-09-03):
  // once English + interview are done, a 14-day window opens; overdue and
  // unverified means hidden from clients until verified. It never blocks
  // review or going live inside the window, so it's tracked as its own
  // node but the "current step" pointer skips it (the grace card below the
  // step card owns that conversation).
  const assessmentsDone = englishDone && interview2Done;
  const idDueAt = candidate?.id_verification_due_at ? new Date(candidate.id_verification_due_at) : null;
  const idOverdue = !idDone && !!idDueAt && idDueAt.getTime() < now;
  const idDaysLeft = idDueAt ? Math.max(0, Math.ceil((idDueAt.getTime() - now) / 86400000)) : null;

  const nodes: PipelineNode[] = [
    { id: "email", label: "Email", xp: 25, state: emailDone ? "completed" : "current" },
    {
      id: "whatsapp",
      label: "WhatsApp",
      xp: 25,
      state: phoneDone ? "completed" : phoneEnabled ? "upcoming" : "waived",
      detail: phoneDone || phoneEnabled ? undefined : "Coming soon — not required yet",
    },
    { id: "english", label: "English", xp: 100, state: englishDone ? "completed" : "upcoming" },
    { id: "recordings", label: "Recordings", xp: 50, state: recordingsDone ? "completed" : "upcoming" },
    { id: "profile", label: "Profile", xp: 50, state: profileDone ? "completed" : "upcoming" },
    { id: "interview1", label: "Interview 1", xp: 100, state: interview1Done ? "completed" : "upcoming" },
    { id: "interview2", label: "Interview 2", xp: 100, state: interview2Done ? "completed" : "upcoming" },
    { id: "id", label: "Identity", xp: 50, state: idDone ? "completed" : "upcoming", detail: assessmentsDone ? "Verify within 14 days of finishing your assessments" : "Unlocks after your assessments" },
    { id: "review", label: "Review", xp: 50, state: underReview ? "current" : "upcoming" },
    { id: "live", label: "Live", xp: 0, state: "upcoming" },
  ];

  // First non-completed, non-waived node becomes current (unless review
  // already owns it). Identity is skipped here — it runs on its own window
  // in parallel and gets its own card.
  if (!underReview) {
    const firstOpen = nodes.find((n) => n.state !== "completed" && n.state !== "waived" && n.id !== "id");
    if (firstOpen) firstOpen.state = "current";
  }
  const currentNode = nodes.find((n) => n.state === "current") || nodes[nodes.length - 1];
  const completedCount = nodes.filter((n) => n.state === "completed").length;
  const waivedCount = nodes.filter((n) => n.state === "waived").length;
  const requiredTotal = nodes.length;
  const xp = 25 /* account created */ + nodes.filter((n) => n.state === "completed").reduce((s, n) => s + n.xp, 0);

  // Per-node presentation for the current-step card.
  const STEP_CARDS: Record<string, { title: string; body: string; cta: string; href: string; minutes: string; tips: string[] }> = {
    email: {
      title: "Verify your email",
      body: "Click the link we sent to your inbox. It proves the address is yours and unlocks the rest of your application.",
      cta: "Open verification page",
      href: `/verify-email?email=${encodeURIComponent(candidate?.email || profile?.email || "")}`,
      minutes: "~1 min",
      tips: ["Check your spam folder if nothing arrives within 2 minutes.", "The link expires after 24 hours — you can always resend."],
    },
    whatsapp: {
      title: "Verify your WhatsApp",
      body: "We send a 6-digit code to your number — job matches, application updates and interview scheduling all reach you there.",
      cta: "Verify my number",
      href: "/verify-phone",
      minutes: "~2 min",
      tips: ["Use a number with WhatsApp active — the code arrives there.", "No WhatsApp on that number? You can get the code by SMS instead."],
    },
    english: {
      title: "Take the Proctored English Assessment",
      body: assessmentFull
        ? "Grammar, reading, speaking and writing on one 24:30 clock, camera-proctored throughout — the room scan and monitoring run for the whole session."
        : "Grammar and reading comprehension on a 15-minute clock, camera-proctored throughout — the room scan and monitoring run for the whole session.",
      cta: candidate ? "Start the assessment" : "Start your application",
      href: candidate ? "/assessment" : "/apply",
      minutes: assessmentFull ? "~25 min" : "~15 min",
      tips: ["You need a working camera, a microphone and a quiet room.", "Leaving fullscreen or switching tabs is flagged — close everything else first."],
    },
    interview1: {
      title: "Interview 1 — the behavioral round",
      body: "A short, camera-proctored interview: five questions about communication, problem-solving and judgment. Each one gives you prep time before you answer.",
      cta: "Start Interview 1",
      href: "interview-app",
      minutes: "~20 min",
      tips: ["Use the prep time — a pause before answering is expected.", "Have one or two real examples in mind. Specifics beat polish."],
    },
    interview2: {
      title: "Interview 2 — the skills round",
      body: "A camera-proctored conversation that probes the skills and tools you claimed. Be ready to walk through how you actually do the work.",
      cta: "Start Interview 2",
      href: "interview-app",
      minutes: "~25 min",
      tips: ["Answer with real examples — the interviewer follows up on claims.", "Quiet room, camera on, phone away."],
    },
    recordings: {
      title: "Record your voice introductions",
      body: "Two short recordings — an oral reading and a self-introduction. Clients hear these on your profile.",
      cta: "Continue to recordings",
      href: "/apply",
      minutes: "~5 min",
      tips: ["Speak naturally; you can re-record before submitting.", "A quiet room beats a good microphone."],
    },
    profile: {
      title: "Build your profile",
      body: "Photo, tagline, bio, resume, payout method — the profile clients actually see. This is your storefront; make it yours.",
      cta: "Continue building",
      href: "/apply",
      minutes: "~10 min",
      tips: ["A clear, friendly photo lifts response rates more than anything else.", "Write the tagline for the client you want, not for everyone."],
    },
    review: {
      title: "You're under review",
      // No turnaround is promised. Nothing measures review latency, no stated
      // SLA has ever been met, and the email this used to promise is the exact
      // kind the freeze withholds. The dashboard is the channel.
      body: "A person is going over your application. We'll show the outcome here as soon as it's decided.",
      cta: "View my application",
      href: "/apply",
      minutes: "no action needed",
      tips: ["Nothing to do — the result appears on this page.", "You can still polish your profile while you wait."],
    },
    live: {
      title: "Going live",
      body: "Once review clears, your profile goes on the marketplace and clients can find you.",
      cta: "View my application",
      href: "/apply",
      minutes: "",
      tips: [],
    },
  };
  // The specialist channel's change items. Three channels can put someone in
  // a revision state, and this one delivered its items ONLY through an email
  // the freeze suppresses — the candidate saw a generic "something needs an
  // update" with no way to learn what.
  let changeItems: { area: string; instruction: string }[] = [];
  if (candidate && ["revision_required", "changes_requested"].includes(candidate.admin_status ?? "")) {
    const { data: pendingReq } = await admin
      .from("candidate_change_requests")
      .select("change_items, general_note")
      .eq("candidate_id", candidate.id)
      .eq("status", "pending")
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const raw = pendingReq?.change_items;
    if (Array.isArray(raw)) {
      changeItems = raw
        .filter((i): i is { area: string; instruction: string } =>
          !!i && typeof i.area === "string" && typeof i.instruction === "string")
        .slice(0, 10);
    }
  }

  // The reviewer's note, shown in the card rather than pointed at in an email
  // the freeze may never send.
  const revisionNote =
    typeof candidate?.admin_revision_note === "string" && candidate.admin_revision_note.trim()
      ? candidate.admin_revision_note.trim()
      : null;

  let card = STEP_CARDS[currentNode.id] || STEP_CARDS.review;
  if (terminal) {
    // A fraud ban and a declined application are different outcomes and get
    // different screens: disputes/resolve sets admin_status='rejected'
    // alongside permanently_blocked, so one shared branch would offer a banned
    // account the friendly "apply again on <date>" card.
    card = candidate?.permanently_blocked
      ? {
          title: "This account is closed",
          body: "This application can't continue. If you believe that's a mistake, our support team will take a look.",
          cta: "Contact support",
          href: "mailto:support@staffva.com",
          minutes: "",
          tips: [],
        }
      : {
          title: "We're not taking your application forward",
          body: candidate?.rejection_reason
            ? candidate.rejection_reason
            : "Our team reviewed your application and it can't move forward right now.",
          cta: candidate?.reapply_eligible_at ? "See what happens next" : "Contact support",
          href: candidate?.reapply_eligible_at ? "/apply" : "mailto:support@staffva.com",
          minutes: "",
          tips: candidate?.reapply_eligible_at
            ? [
                `You can apply again from ${new Date(candidate.reapply_eligible_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.`,
                "Your assessments and interviews stay on file — you won't repeat them.",
              ]
            : [],
        };
  } else if (actionRequired) {
    card = {
      title: "Your reviewer left feedback",
      body: revisionNote
        ? `Your reviewer asked for a change before this can continue: ${revisionNote}`
        : "Something in your application needs an update before review can continue. Make the change and it goes back to the reviewer.",
      cta: "Update my application",
      href: "/apply",
      minutes: "~10 min",
      // The note itself is shown above rather than pointing at an email that
      // may never arrive, and no queue-position claim: the admin queue sorts
      // newest-first and resubmitting changes neither sort key.
      tips: ["Change what the note asks for, then resubmit."],
    };
  } else if (interviewFailed) {
    // The retake owns the card whenever the interview is failed, even when the
    // step pointer sits on an earlier node (e.g. WhatsApp arriving mid-funnel
    // put the pointer there for pre-Twilio candidates). The status banner says
    // "interview didn't pass" — the card under it must answer THAT, retake
    // date included, not change the subject. The skipped node's card comes
    // back as soon as the retake is passed.
    // Which interview failed? interview1Done is false only when Interview 1
    // is still outstanding — so the retake copy names the right round.
    const failedRound = interview1Done ? "Interview 2" : "Interview 1";
    card = {
      title: interviewLocked ? `${failedRound} retake on cooldown` : `Retake ${failedRound}`,
      body: interviewLocked
        ? "The interview didn't go your way last time — it happens. Your retake is on a short cooldown; use it to prepare."
        : interview1Done
          ? "Your retake is ready. Same format as before: a camera-proctored conversation probing the skills you claimed — go in with real examples."
          : "Your retake is ready. Same format as before: five behavioral questions, each with prep time before you answer.",
      cta: "Start the retake",
      href: "interview-app",
      minutes: interview1Done ? "~25 min" : "~20 min",
      tips: interview1Done
        ? ["Re-read your own application first — the interviewer probes what you wrote.", "Quiet room, camera on, phone away."]
        : ["Use the prep time — a pause before answering is expected.", "Have one or two real examples in mind. Specifics beat polish."],
    };
  }
  // The English-lockout copy may only override the step card's own body/CTA.
  // Terminal and action-required cards outrank it: "This application is
  // closed" must not be followed by "Your next attempt opens…".
  const englishLockoutOverride =
    englishLocked && currentNode.id === "english" && !!lockedUntil && !terminal && !actionRequired;
  const currentIndex = nodes.findIndex((n) => n.id === currentNode.id);
  const upcomingPreview = nodes.filter((n) => n.state === "upcoming").slice(0, 3);
  const UPCOMING_BLURBS: Record<string, string> = {
    whatsapp: "A one-time code confirms the number where job matches and updates will reach you.",
    id: "Upload a government ID within 14 days of finishing your assessments — after that, unverified profiles hide from clients.",
    english: "A camera-proctored assessment of grammar and comprehension.",
    interview1: "A short behavioral interview — communication, problem-solving, judgment.",
    interview2: "A skills interview that probes what you claimed you can do.",
    recordings: "Two short voice recordings clients hear on your profile.",
    profile: "Photo, tagline, bio, resume and payout — your storefront.",
    review: "A human reviewer signs off before anything goes live.",
    live: "Your profile joins the marketplace.",
  };

  // The (portal) layout provides the Atlas shell — sidebar, topbar, fonts,
  // the .lp wrapper. This page is only the content column now; its old inline
  // <nav> is gone because two navbars is one of the things the shell exists
  // to end.
  return (
    <main style={{ maxWidth: "980px", margin: "0 auto" }}>
        {/* ── Welcome ── */}
        <section className="dash-welcome">
          <div className={`status-banner ${terminal ? "rejected" : lockedOut ? "cooldown" : underReview ? "waiting" : actionRequired ? "waiting" : ""}`}>
            <span className="status-pulse" aria-hidden></span>
            <span>
              {terminal ? "This application is closed"
                : lockedOut ? "On a short break — retake opens soon"
                : underReview ? "Your application is with our review team"
                : actionRequired ? "Action needed — our team left you feedback"
                : interviewFailed ? "Interview retake ready when you are"
                : "Ready for your next step"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "24px", flexWrap: "wrap" }}>
            <div>
              <h1>
                <span>Welcome, <span className="welcome-name">{firstName}</span>.</span><br />
                <span>{terminal ? "Thanks for applying." : underReview ? "Almost there." : "Let's get you approved."}</span>
              </h1>
              <p className="welcome-sub">
                {terminal
                  ? "This application can't move forward. If you think that's a mistake, support can take a look."
                  : underReview
                  ? "Everything is submitted. A human reviewer takes it from here."
                  : actionRequired
                  ? "Check your email for the details, then update your application below."
                  : "Your next step is waiting below — most candidates finish it in a few minutes."}
              </p>
              <div style={{ marginTop: "14px" }}>
                <AstiPointChip label={`${xp} asterisk points`} />
              </div>
            </div>
            <AstiProgressRing ratio={completedCount / (requiredTotal - waivedCount)} size={132} />
          </div>
        </section>

        {/* ── Pipeline tracker ── */}
        <section className="pipeline-full" aria-labelledby="pipelineFullHeading">
          <div className="pipeline-full-header">
            <h3 id="pipelineFullHeading">Your application</h3>
            <span className="progress-count"><strong>{completedCount}</strong> of {requiredTotal} complete · {waivedCount} coming soon</span>
          </div>
          <div className="pipeline-track-wrap">
            <ol className="pipeline-track">
              {nodes.map((n, i) => (
                <li
                  key={n.id}
                  className={`pipeline-node ${n.state}`}
                  aria-current={n.state === "current" ? "step" : undefined}
                  aria-label={`Step ${i + 1}, ${n.label}, ${n.state}`}
                  title={n.detail || undefined}
                >
                  {n.state === "current" && (
                    <span className="asti-rider">
                      <Asti variant={lockedOut ? "rest" : "idle"} size={44} animate={!lockedOut} />
                    </span>
                  )}
                  <span className="node-circle">
                    <span className="node-num">{i + 1}</span>
                    <span className="node-check" aria-hidden>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5 5 9l4.5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </span>
                  </span>
                  <span className="node-label">{n.label}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Current step card ── */}
        <section className="current-step-card active" aria-labelledby="currentStepTitle">
          <div className="current-step-body">
            <div className="current-step-header">
              <div className="current-step-icon" aria-hidden>
                <Asti variant={lockedOut ? "rest" : "idle"} size={40} animate={false} />
              </div>
              <div className="current-step-title-group">
                <span className="current-step-eyebrow">Next up · Step {currentIndex + 1} of {requiredTotal}</span>
                <h2 className="current-step-title" id="currentStepTitle">{card.title}</h2>
              </div>
              {card.minutes && <span className="current-step-meta-chip">{card.minutes}</span>}
            </div>
            <p className="current-step-body-text">
              {englishLockoutOverride
                ? `Your next attempt opens ${lockedUntil!.toLocaleDateString("en-US", { month: "long", day: "numeric" })} at ${lockedUntil!.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}. Use the wait — the practice resources below can help you prepare.`
                : card.body}
            </p>
            {englishLockoutOverride && (
              <>
                <div className="retake-countdown">
                  <span className="count-val">
                    {Math.max(1, Math.ceil((lockedUntil!.getTime() - now) / 86400000))}
                  </span>
                  <span className="count-meta">
                    <strong>Days until you can retake</strong>
                    <span className="retake-date">
                      Available {lockedUntil!.toLocaleDateString("en-US", { month: "long", day: "numeric" })}
                    </span>
                  </span>
                </div>
                {englishParts && (
                  <div className="feedback-block">
                    <span className="feedback-block-label">Your last attempt</span>
                    <h4>Where you landed</h4>
                    <div className="score-row">
                      {(
                        [
                          ["grammar", "Grammar"],
                          ["comprehension", "Comprehension"],
                          ["read_aloud", "Read-aloud"],
                          ["listening", "Listening"],
                          ["speaking", "Speaking"],
                          ["writing", "Writing"],
                        ] as const
                      )
                        .filter(([key]) => typeof englishParts![key] === "number")
                        .map(([key, label]) => {
                          const v = englishParts![key] as number;
                          return (
                            <span className="score-item" key={key}>
                              <span className={`score-n${v >= 75 ? " strong" : v < 60 ? " weak" : ""}`}>{v}</span>
                              <span className="score-lbl">{label}</span>
                            </span>
                          );
                        })}
                    </div>
                  </div>
                )}
                <div className="resource-links">
                  {[
                    { title: "BBC Learning English", meta: "Lessons · Free", href: "https://www.bbc.co.uk/learningenglish" },
                    { title: "Duolingo", meta: "App · Free", href: "https://www.duolingo.com" },
                    { title: "ELSA Speak", meta: "Pronunciation · Freemium", href: "https://elsaspeak.com" },
                  ].map((r) => (
                    <a key={r.title} className="resource-link" href={r.href} target="_blank" rel="noopener noreferrer">
                      <span className="resource-link-icon" aria-hidden>
                        ↗
                      </span>
                      <span className="resource-link-title">{r.title}</span>
                      <span className="resource-link-meta">{r.meta}</span>
                    </a>
                  ))}
                </div>
              </>
            )}
            <div className="current-step-actions">
              {englishLockoutOverride ? (
                <span className="current-step-meta-chip">Retake locked until {lockedUntil!.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              ) : interviewLocked && card.href === "interview-app" ? (
                <span className="current-step-meta-chip">
                  Retake opens {interviewRetakeAt!.toLocaleDateString("en-US", { month: "short", day: "numeric" })} at {interviewRetakeAt!.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                </span>
              ) : card.href === "interview-app" ? (
                <StartInterviewButton label={card.cta} />
              ) : card.href.startsWith("mailto:") ? (
                <a href={card.href} className="current-step-cta"><span>{card.cta}</span></a>
              ) : (
                <Link href={card.href} className="current-step-cta">
                  <span>{card.cta}</span>
                </Link>
              )}
            </div>
            {card.tips.length > 0 && (
              <div className="tips-section">
                <details className="tips-details">
                  <summary className="tips-toggle" style={{ listStyle: "none", cursor: "pointer" }}>
                    Show tips for success
                    <span className="tips-chevron" aria-hidden>▾</span>
                  </summary>
                  <div className="tips-content" style={{ display: "block" }}>
                    <ul>
                      {card.tips.map((t) => (<li key={t}>{t}</li>))}
                    </ul>
                  </div>
                </details>
              </div>
            )}

            {/* The three doors the step-18 audit found promised but absent.
                Every API existed; nothing called them. */}
            {actionRequired && changeItems.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>What to change:</p>
                <ul style={{ paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
                  {changeItems.map((i, n) => (
                    <li key={n} style={{ fontSize: 14 }}>
                      <strong>{i.area}:</strong> {i.instruction}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {actionRequired && <ResubmitButton />}
            {status === "rejected" && !candidate?.permanently_blocked && (
              candidate?.appeal_decision ? (
                <div style={{ marginTop: 16, fontSize: 14 }}>
                  <p style={{ fontWeight: 600 }}>
                    {candidate.appeal_decision === "overturned"
                      ? "Your appeal was accepted."
                      : "Your appeal was reviewed and the decision stands."}
                  </p>
                  {candidate.appeal_response && (
                    <p style={{ marginTop: 6, color: "var(--ink-mute, #6B6860)" }}>{candidate.appeal_response}</p>
                  )}
                </div>
              ) : candidate?.appeal_submitted_at ? (
                <p style={{ marginTop: 16, fontSize: 14 }}>
                  Your appeal is with the team. The decision will appear here.
                </p>
              ) : (
                <AppealForm />
              )
            )}
            {status === "rejected" &&
              !candidate?.permanently_blocked &&
              candidate?.reapply_eligible_at &&
              new Date(candidate.reapply_eligible_at) <= new Date() && <ReapplyButton />}
          </div>
        </section>

        {/* ── ID verification window ── */}
        {assessmentsDone && !idDone && !terminal && candidate?.id_verification_status !== "manual_review" && (
          <section className={`current-step-card active`} aria-label="Identity verification window">
            <div className="current-step-body">
              <div className="current-step-header">
                <div className="current-step-icon" aria-hidden>
                  <Asti variant={idOverdue ? "rest" : "idle"} size={40} animate={false} />
                </div>
                <div className="current-step-title-group">
                  <span className="current-step-eyebrow" style={idOverdue ? { color: "var(--danger)" } : undefined}>
                    {idOverdue ? "Overdue — profile hidden" : idDaysLeft !== null ? `Identity verification · ${idDaysLeft} day${idDaysLeft === 1 ? "" : "s"} left` : "Identity verification"}
                  </span>
                  <h2 className="current-step-title">{idOverdue ? "Verify your ID to get visible again" : "Verify your ID"}</h2>
                </div>
                <span className="current-step-meta-chip">~5 min</span>
              </div>
              <p className="current-step-body-text">
                {idOverdue
                  ? "Your 14-day window has passed, so your profile is hidden from clients right now. Verify your government ID and you're back on the marketplace immediately."
                  : "You've finished your assessments — verify your government ID within 14 days. Inside the window you stay fully visible to clients; miss it and your profile hides until you verify."}
              </p>
              <div className="current-step-actions">
                <Link href="/verify-id" className="current-step-cta">
                  <span>Verify my ID</span>
                </Link>
              </div>
            </div>
          </section>
        )}

        {/* ── Coming up + help ── */}
        <div className="dash-bottom-grid">
          <section className="panel-card">
            <span className="panel-eyebrow">Coming up</span>
            <h3>After this step</h3>
            <ol className="whats-next-list">
              {upcomingPreview.map((n) => (
                <li className="whats-next-item" key={n.id}>
                  <span className="whats-next-num">{nodes.findIndex((x) => x.id === n.id) + 1}</span>
                  <div className="whats-next-body">
                    <h4>{n.label}</h4>
                    <p>{UPCOMING_BLURBS[n.id] || ""}</p>
                  </div>
                </li>
              ))}
              {upcomingPreview.length === 0 && (
                <li className="whats-next-item">
                  <div className="whats-next-body">
                    <h4>That&apos;s everything</h4>
                    <p>Nothing left on your side.</p>
                  </div>
                </li>
              )}
            </ol>
          </section>

          <section className="panel-card">
            <span className="panel-eyebrow">Support</span>
            <h3>Need a hand?</h3>
            <ul className="help-list">
              <li>
                <a href="mailto:support@staffva.com">
                  Contact support
                  <span className="help-arrow" aria-hidden>→</span>
                </a>
              </li>
              <li>
                <Link href="/apply">
                  View my full application
                  <span className="help-arrow" aria-hidden>→</span>
                </Link>
              </li>
              <li>
                <Link href="/account/security">
                  Account security
                  <span className="help-arrow" aria-hidden>→</span>
                </Link>
              </li>
            </ul>
          </section>
        </div>
      </main>
  );
}
