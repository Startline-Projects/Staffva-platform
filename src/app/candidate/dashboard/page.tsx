import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import Navbar from "@/components/Navbar";
import StaffvaLogo from "@/components/landing/StaffvaLogo";
import Asti, { AstiPointChip, AstiProgressRing } from "@/components/landing/Asti";
import LegacyDashboard from "@/app/(main)/candidate/dashboard/LegacyDashboard";
import StartInterviewButton from "@/app/candidate/dashboard/StartInterviewButton";
import "@/app/landing.css";
import "@/app/atlas-auth.css";
import "@/app/atlas-dash.css";

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
 * pages progressively). WhatsApp and Interview 2 render as "waived" until
 * their steps ship: showing them as required before they exist would be a
 * lie, and hiding them would misnumber the pipeline everyone signed up to.
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
    admin.from("candidates").select("id, admin_status, first_name, display_name, full_name, email, id_verification_status, english_mc_score, english_comprehension_score, test_completed_at, ai_interview_passed, ai_interview_completed_at, voice_recording_1_url, voice_recording_2_url, profile_photo_url, resume_url, tagline, bio, payout_method, retake_available_at, test_lockout_until, permanently_blocked, application_step, id_verification_due_at").eq("user_id", user.id).maybeSingle(),
  ]);

  // A failed lookup must not masquerade as a fresh applicant — a candidate
  // with a record would see step 1 of an application they already finished.
  if (candidateError) {
    throw new Error(`candidate lookup failed: ${candidateError.message}`);
  }

  // Interview retake window (only meaningful after a failed interview).
  let interviewRetakeAt: Date | null = null;
  if (candidate?.admin_status === "ai_interview_failed") {
    const { data: attempt } = await admin
      .from("interview_attempts")
      .select("next_retake_available_at")
      .eq("candidate_id", candidate.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (attempt?.next_retake_available_at) interviewRetakeAt = new Date(attempt.next_retake_available_at);
  }

  // The live portal is step 13 — until then, approved candidates keep the
  // dashboard they know — plus the ID-window banner: they are exactly the
  // cohort the 14-day rule can hide, so the countdown must reach them.
  if (candidate?.admin_status === "approved") {
    const approvedIdDue = candidate.id_verification_due_at ? new Date(candidate.id_verification_due_at) : null;
    const idPending = ["manual_review"].includes(candidate.id_verification_status || "");
    const needsId = candidate.id_verification_status !== "passed" && !idPending && !!approvedIdDue;
    // eslint-disable-next-line react-hooks/purity
    const nowMs = Date.now();
    const overdue = needsId && approvedIdDue!.getTime() < nowMs;
    const daysLeft = needsId ? Math.max(0, Math.ceil((approvedIdDue!.getTime() - nowMs) / 86400000)) : 0;
    return (
      <>
        <Navbar />
        {needsId && (
          <div className={`${overdue ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"} border-b px-6 py-3 text-center`}>
            <p className={`text-sm ${overdue ? "text-red-800" : "text-amber-800"}`}>
              {overdue ? (
                <><strong>Your profile is hidden from clients</strong> — the 14-day ID window has passed. Verify your ID and you&apos;re visible again immediately.{" "}</>
              ) : (
                <><strong>Verify your ID</strong> — {daysLeft} day{daysLeft === 1 ? "" : "s"} left. After that, your profile hides from clients until you verify.{" "}</>
              )}
              <Link href="/apply?flow=id" className="underline font-semibold">Verify now</Link>
            </p>
          </div>
        )}
        <LegacyDashboard />
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
  const idDone = candidate?.id_verification_status === "passed";
  const englishDone = (candidate?.english_mc_score ?? 0) >= 70 && (candidate?.english_comprehension_score ?? 0) >= 70;
  const interview1Done = candidate?.ai_interview_passed === true;
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
  const assessmentsDone = englishDone && interview1Done;
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
    { id: "interview2", label: "Interview 2", xp: 100, state: "waived", detail: "Coming soon — not required yet" },
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
      title: "Take the proctored English assessment",
      body: "A camera-proctored test of grammar and comprehension. Find a quiet spot — the room scan and monitoring run for the whole session.",
      cta: candidate ? "Continue to the assessment" : "Start your application",
      href: "/apply",
      minutes: "~25 min",
      tips: ["You need a working camera and a quiet room.", "Leaving fullscreen or switching tabs is flagged — close everything else first."],
    },
    interview1: {
      title: "Complete your AI interview",
      body: "A structured, camera-proctored interview with our AI interviewer. It probes the skills you claimed — be ready to talk specifics.",
      cta: "Continue to the interview",
      href: "/apply",
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
      body: "A human reviewer is going over your application. Most reviews finish within 2 business days — we'll email you the moment there's news.",
      cta: "View my application",
      href: "/apply",
      minutes: "no action needed",
      tips: ["No need to do anything — but keep an eye on your inbox.", "You can still polish your profile while you wait."],
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
  let card = STEP_CARDS[currentNode.id] || STEP_CARDS.review;
  if (terminal) {
    card = {
      title: "This application is closed",
      body: candidate?.permanently_blocked
        ? "This application can't continue. If you believe that's a mistake, our support team will take a look."
        : "Our team reviewed your application and it can't move forward right now. If you believe that's a mistake, support can walk you through it.",
      cta: "Contact support",
      href: "mailto:support@staffva.com",
      minutes: "",
      tips: [],
    };
  } else if (actionRequired) {
    card = {
      title: "Your reviewer left feedback",
      body: "Something in your application needs an update before review can continue — the details are in your email. Make the changes and it goes straight back to the reviewer.",
      cta: "Update my application",
      href: "/apply",
      minutes: "~10 min",
      tips: ["The email lists exactly what to change — fix only that.", "Resubmitting puts you back at the front of the reviewer's queue."],
    };
  } else if (interviewFailed) {
    // The retake owns the card whenever the interview is failed, even when the
    // step pointer sits on an earlier node (e.g. WhatsApp arriving mid-funnel
    // put the pointer there for pre-Twilio candidates). The status banner says
    // "interview didn't pass" — the card under it must answer THAT, retake
    // date included, not change the subject. The skipped node's card comes
    // back as soon as the retake is passed.
    card = {
      title: interviewLocked ? "Interview retake on cooldown" : "Retake your AI interview",
      body: interviewLocked
        ? "The interview didn't go your way last time — it happens. Your retake is on a short cooldown; use it to prep the specifics of your claimed skills."
        : "Your retake is ready. Same format as before: a structured, camera-proctored interview probing the skills you claimed — go in with real examples.",
      cta: "Start the retake",
      href: "interview-app",
      minutes: "~25 min",
      tips: ["Re-read your own application first — the interviewer probes what you wrote.", "Quiet room, camera on, phone away."],
    };
  }
  const currentIndex = nodes.findIndex((n) => n.id === currentNode.id);
  const upcomingPreview = nodes.filter((n) => n.state === "upcoming").slice(0, 3);
  const UPCOMING_BLURBS: Record<string, string> = {
    whatsapp: "A one-time code confirms the number where job matches and updates will reach you.",
    id: "Upload a government ID within 14 days of finishing your assessments — after that, unverified profiles hide from clients.",
    english: "A camera-proctored assessment of grammar and comprehension.",
    interview1: "A structured AI interview that probes the skills you claim.",
    interview2: "A role-specific second round — questions branch by your category.",
    recordings: "Two short voice recordings clients hear on your profile.",
    profile: "Photo, tagline, bio, resume and payout — your storefront.",
    review: "A human reviewer signs off before anything goes live.",
    live: "Your profile joins the marketplace.",
  };

  return (
    <div className="lp lp-auth lp-dash">
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900&family=Geist:wght@300..900&family=Geist+Mono:wght@400..600&display=swap"
        rel="stylesheet"
      />
      <nav className="nav" id="nav">
        <div className="nav-inner">
          <Link href="/" className="logo" aria-label="StaffVA — go to homepage">
            <StaffvaLogo />
          </Link>
          <div className="nav-right">
            <span className="existing-q">{candidate?.email || profile?.email || ""}</span>
            <Link href="/account/security" className="signin">Account</Link>
          </div>
        </div>
      </nav>

      <main className="page" style={{ maxWidth: "980px", margin: "0 auto" }}>
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
              {englishLocked && currentNode.id === "english" && lockedUntil
                ? `Your next attempt opens ${lockedUntil.toLocaleDateString("en-US", { month: "long", day: "numeric" })} at ${lockedUntil.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}. Take the break — the test isn't going anywhere.`
                : card.body}
            </p>
            <div className="current-step-actions">
              {englishLocked && currentNode.id === "english" && lockedUntil ? (
                <span className="current-step-meta-chip">Retake locked until {lockedUntil.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
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
                <Link href="/apply?flow=id" className="current-step-cta">
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
    </div>
  );
}
