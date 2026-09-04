import { createClient } from "@supabase/supabase-js";
import { getUser } from "@/lib/auth";
import { generateInterviewToken } from "@/lib/interviewToken";
import Link from "next/link";
import NotifyButton from "@/components/browse/NotifyButton";
import InterviewScheduler from "@/components/booking/InterviewScheduler";
import ProfileViewTracker from "@/components/ProfileViewTracker";
import ApproveButton from "@/components/recruiting-manager/ApproveButton";
import BanButton from "@/components/recruiting-manager/BanButton";
import AtlasNav from "@/components/landing/AtlasNav";
import AtlasFooter from "@/components/landing/AtlasFooter";
import ProfileInteractive from "@/components/landing/ProfileInteractive";
import { hasUsExperience } from "@/lib/usExperienceLabels";
import { maskCandidateText, maskContact } from "@/lib/contactMask";
import "@/app/landing.css";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const TIER_LABELS: Record<string, string> = {
  exceptional: "Exceptional",
  advanced: "Advanced",
  professional: "Professional",
};

const US_EXPERIENCE_LABELS: Record<string, string> = {
  less_than_6_months: "Less than 6 months US client experience",
  "6_months_to_1_year": "6 months to 1 year US client experience",
  "1_to_2_years": "1 to 2 years US client experience",
  "2_to_5_years": "2 to 5 years US client experience",
  "5_plus_years": "5+ years US client experience",
  international_only: "International clients only",
  none: "No prior international client experience",
  // Legacy values — kept until migration backfills existing rows
  full_time: "Full-time US client experience",
  part_time_contract: "Part-time / contract US experience",
};

const FLAGS: Record<string, string> = {
  Philippines: "🇵🇭", India: "🇮🇳", Egypt: "🇪🇬", Kenya: "🇰🇪", Nigeria: "🇳🇬",
  Pakistan: "🇵🇰", Colombia: "🇨🇴", Argentina: "🇦🇷", Mexico: "🇲🇽", Brazil: "🇧🇷",
  Kuwait: "🇰🇼", Jordan: "🇯🇴", Morocco: "🇲🇦", Tunisia: "🇹🇳", Bangladesh: "🇧🇩",
  Indonesia: "🇮🇩", Vietnam: "🇻🇳", "South Africa": "🇿🇦", Ghana: "🇬🇭", Peru: "🇵🇪",
  Venezuela: "🇻🇪", Honduras: "🇭🇳", Guatemala: "🇬🇹", "El Salvador": "🇸🇻", Nicaragua: "🇳🇮",
  Lebanon: "🇱🇧",
};

/** "Asia/Calcutta" is an IANA id, not a sentence — clients get the words. */
function humanizeTimeZone(tz: string | null): string {
  if (!tz) return "—";
  try {
    const at = new Date();
    const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longGeneric" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    const offset = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    if (name && offset) return `${name} (${offset})`;
    return name || tz;
  } catch {
    return tz;
  }
}

async function signedMediaUrl(bucket: string, path: string): Promise<string> {
  if (path.startsWith("http")) return path;
  const supabase = getAdminClient();
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  return data?.signedUrl || "";
}

async function VoiceCard({ path, label }: { path: string; label: string }) {
  const url = await signedMediaUrl("voice-recordings", path);
  return (
    <div className="voice-audio-card">
      <div className="voice-audio-label">{label}</div>
      {url ? (
        <audio controls src={url} preload="metadata" />
      ) : (
        <p style={{ fontSize: "12px", color: "var(--ink-mute)", fontStyle: "italic" }}>Audio unavailable</p>
      )}
    </div>
  );
}

async function ProfileVideo({ path }: { path: string }) {
  const url = await signedMediaUrl("video-intros", path);
  if (!url) return null;
  return <video controls playsInline src={url} preload="metadata" />;
}

const LOCK_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
);

export default async function CandidateProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getAdminClient();
  const user = await getUser();
  const isLoggedIn = !!user;
  const isClient = user?.app_metadata?.role === "client";
  const isCandidate = user?.app_metadata?.role === "candidate";
  const isAdmin = user?.app_metadata?.role === "admin";
  const isRecruitingManager = user?.app_metadata?.role === "recruiting_manager";
  const isRecruiter = user?.app_metadata?.role === "recruiter";

  // First try to find approved candidate (public view)
  let { data: candidate } = await supabase
    .from("candidates")
    .select("*")
    .eq("id", id)
    .eq("admin_status", "approved")
    // Overdue-unverified profiles are hidden from clients (00154). Their
    // owner and staff still reach them through the branches below.
    .or("id_verification_status.in.(passed,manual_review),id_verification_due_at.is.null,id_verification_due_at.gt." + new Date().toISOString())
    .single();

  // If not found and user is the candidate themselves, show their own profile
  let isOwnProfile = false;
  if (!candidate && isCandidate && user) {
    const { data: ownCandidate } = await supabase
      .from("candidates")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (ownCandidate) {
      candidate = ownCandidate;
      isOwnProfile = true;
    }
  }

  // If candidate is trying to view someone else's profile, block it
  if (isCandidate && !isOwnProfile && !candidate) {
    return (
      <div className="lp">
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=Geist:wght@300..900&family=Geist+Mono:wght@400..600&display=swap"
        rel="stylesheet"
      />
        <AtlasNav signedIn />
        <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: "80px 24px" }}>
          <div style={{ textAlign: "center" }}>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: "32px", fontWeight: 500 }}>Access Restricted</h1>
            <p style={{ marginTop: "8px", fontSize: "14px", color: "var(--ink-mute)" }}>Candidate accounts cannot view other profiles.</p>
            <Link href="/apply" className="btn btn-primary" style={{ marginTop: "24px" }}>
              Go to My Application
            </Link>
          </div>
        </div>
        <AtlasFooter />
      </div>
    );
  }

  // If not found and user is staff — show any candidate regardless of status
  if (!candidate && (isAdmin || isRecruitingManager || isRecruiter)) {
    const { data: staffCandidate } = await supabase
      .from("candidates")
      .select("*")
      .eq("id", id)
      .single();

    if (staffCandidate) {
      candidate = staffCandidate;
    }
  }

  if (!candidate) {
    return (
      <div className="lp">
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=Geist:wght@300..900&family=Geist+Mono:wght@400..600&display=swap"
        rel="stylesheet"
      />
        <AtlasNav signedIn={isLoggedIn} />
        <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: "80px 24px" }}>
          <div style={{ textAlign: "center" }}>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: "32px", fontWeight: 500 }}>Profile Not Found</h1>
            <p style={{ marginTop: "8px", fontSize: "14px", color: "var(--ink-mute)" }}>This candidate may no longer be available.</p>
            <Link href="/browse" className="btn btn-primary" style={{ marginTop: "24px" }}>
              ← Browse Talent
            </Link>
          </div>
        </div>
        <AtlasFooter />
      </div>
    );
  }

  let clientId: string | null = null;
  if (isClient) {
    const { data: client } = await supabase
      .from("clients")
      .select("id")
      .eq("user_id", user!.id)
      .single();
    if (client) clientId = client.id;
  }

  // Pre-hire contact masking: clients and anonymous visitors see the bio,
  // tagline and work history with contact details masked. The candidate
  // sees their own text raw, and staff always see raw.
  const isStaff = isAdmin || isRecruitingManager || isRecruiter;
  const viewingOwn = isOwnProfile || (isCandidate && !!user && candidate.user_id === user.id);
  if (!viewingOwn && !isStaff) {
    candidate = maskCandidateText(candidate);
  }

  // Compute availability from committed_hours
  const committedHours = candidate.committed_hours || 0;
  const availabilityComputed = committedHours === 0
    ? "available"
    : committedHours < 40
    ? "partial"
    : "unavailable";
  const remainingHours = Math.max(0, 40 - committedHours);

  // Latest completed AI interview with scorecard fields
  const { data: aiInterview } = await supabase
    .from("ai_interviews")
    .select("overall_score, technical_knowledge_score, problem_solving_score, communication_score, experience_depth_score, professionalism_score, status, passed, badge_level, technical_knowledge_feedback, problem_solving_feedback, communication_feedback, experience_depth_feedback, professionalism_feedback, strengths, weaknesses, ai_notes")
    .eq("kind", "skills")
    .eq("candidate_id", id)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const tierLabel = candidate.english_written_tier ? TIER_LABELS[candidate.english_written_tier] : null;
  const hasUSExperience = hasUsExperience(candidate.us_client_experience);
  const displayedName = candidate.display_name || candidate.full_name;
  const firstName = (displayedName || "them").split(" ")[0];
  const canViewGated = isLoggedIn && (isClient || isOwnProfile || isAdmin || isRecruitingManager);

  // Minted here rather than from a bare candidate id in a query string —
  // isOwnProfile is established from user_id, so this is authenticated by
  // construction.
  const ownInterviewToken =
    isOwnProfile && !candidate.ai_interview_completed_at
      ? await generateInterviewToken(candidate.id)
      : null;

  const aiInterviewCompleted = !!aiInterview;
  const skills: string[] = candidate.skills || [];
  const tools: string[] = candidate.tools || [];
  const rawWorkExperience: { company_name?: string; role_title: string; industry: string; duration: string; description: string; start_date?: string; end_date?: string }[] = candidate.work_experience || [];
  const workExperience = [...rawWorkExperience].sort((a, b) => {
    const aIsCurrent = !a.end_date || a.end_date === "present";
    const bIsCurrent = !b.end_date || b.end_date === "present";
    if (aIsCurrent && !bIsCurrent) return -1;
    if (!aIsCurrent && bIsCurrent) return 1;
    if (aIsCurrent && bIsCurrent) return (b.start_date || "").localeCompare(a.start_date || "");
    const endCompare = (b.end_date || "").localeCompare(a.end_date || "");
    if (endCompare !== 0) return endCompare;
    return (b.start_date || "").localeCompare(a.start_date || "");
  });

  const { data: portfolioItemsRaw } = await supabase
    .from("portfolio_items")
    .select("*")
    .eq("candidate_id", id)
    .order("display_order");
  // Portfolio descriptions are candidate free text — mask pre-hire.
  const portfolioItems =
    !viewingOwn && !isStaff
      ? (portfolioItemsRaw || []).map((item) => ({
          ...item,
          description: item.description ? maskContact(item.description) : item.description,
        }))
      : portfolioItemsRaw;

  const { data: tenureBadges } = await supabase
    .from("tenure_badges")
    .select("badge_type, awarded_at")
    .eq("candidate_id", id);

  const { data: reviews } = await supabase
    .from("reviews")
    .select("rating, body, submitted_at")
    .eq("candidate_id", id)
    .eq("published", true)
    .order("submitted_at", { ascending: false });

  const avgRating = reviews && reviews.length > 0
    ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
    : null;

  const earningsAmt = Number(candidate.total_earnings_usd);
  const earningsLabel = !earningsAmt || earningsAmt <= 0 ? null
    : earningsAmt >= 100000 ? "$100K+ earned" : earningsAmt >= 50000 ? "$50K+ earned"
    : earningsAmt >= 25000 ? "$25K+ earned" : earningsAmt >= 10000 ? "$10K+ earned"
    : earningsAmt >= 5000 ? "$5K+ earned" : "$1K+ earned";

  const hasApprovedVideo = candidate.video_intro_status === "approved" && !!candidate.video_intro_url;
  // Server component — one render per request, so the clock read is the
  // correct per-request behavior.
  // eslint-disable-next-line react-hooks/purity
  const hiddenForId =
    candidate.id_verification_status !== "passed" &&
    !!candidate.id_verification_due_at &&
    new Date(candidate.id_verification_due_at).getTime() < Date.now();
  const idVerified = candidate.id_verification_status === "passed";
  // Trust marks belong to LIVE listings only — a rejected or in-review
  // profile viewed by its owner or staff must not wear them.
  const isLive = candidate.admin_status === "approved";

  // The Atlas scorecard, fed by real screening numbers only. The interview
  // stores each dimension /20; everything renders /100 here.
  const englishRows = candidate.english_mc_score > 0 && candidate.english_comprehension_score > 0
    ? [
        { label: "English communication", score: Math.round(candidate.english_comprehension_score) },
        { label: "Grammar & language", score: Math.round(candidate.english_mc_score) },
      ]
    : [];
  const interviewRows = aiInterview && aiInterview.passed && aiInterview.overall_score
    ? [
        { label: "Technical knowledge", score: Math.round((aiInterview.technical_knowledge_score || 0) * 5), feedback: aiInterview.technical_knowledge_feedback },
        { label: "Problem solving", score: Math.round((aiInterview.problem_solving_score || 0) * 5), feedback: aiInterview.problem_solving_feedback },
        { label: "Communication", score: Math.round((aiInterview.communication_score || 0) * 5), feedback: aiInterview.communication_feedback },
        { label: "Experience depth", score: Math.round((aiInterview.experience_depth_score || 0) * 5), feedback: aiInterview.experience_depth_feedback },
        { label: "Professionalism", score: Math.round((aiInterview.professionalism_score || 0) * 5), feedback: aiInterview.professionalism_feedback },
      ]
    : [];
  const textBlocks = interviewRows.length
    ? [
        { label: "Strengths", value: aiInterview!.strengths },
        { label: "Areas for improvement", value: aiInterview!.weaknesses },
        { label: "Screening notes", value: aiInterview!.ai_notes },
      ].filter((b) => b.value)
    : [];
  const hasScorecard = candidate.admin_status === "approved" && (englishRows.length > 0 || interviewRows.length > 0);

  const weeklyRate = candidate.hourly_rate ? Math.round(Number(candidate.hourly_rate) * 40).toLocaleString() : null;

  return (
    <div className="lp">
      {/* Same landing faces as the rest of the Atlas skin. */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=Geist:wght@300..900&family=Geist+Mono:wght@400..600&display=swap"
        rel="stylesheet"
      />
      <AtlasNav signedIn={isLoggedIn} />

      {/* Track profile view for logged-in clients */}
      {isClient && !isOwnProfile && <ProfileViewTracker candidateId={id} />}

      {/* ── Own-profile status banners (functional, kept verbatim) ── */}
      {isOwnProfile && (candidate.admin_status === "active" || candidate.admin_status === "profile_review" || candidate.admin_status === "under_review") && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 text-center">
          <p className="text-sm text-amber-800">
            <strong>Profile under review</strong> — Our team is reviewing your profile. Check your dashboard for the latest status.
          </p>
        </div>
      )}
      {isOwnProfile && candidate.admin_status === "revision_required" && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-3 text-center">
          <p className="text-sm text-red-800">
            <strong>Action required</strong> — Our team has reviewed your profile and left feedback. Check your email for details on what to update.
          </p>
          <Link href="/apply" className="mt-1 inline-block text-sm font-semibold text-red-700 underline hover:text-red-900">
            Edit your profile
          </Link>
        </div>
      )}
      {isOwnProfile && candidate.admin_status === "rejected" && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-3 text-center">
          <p className="text-sm text-red-800">
            <strong>Profile needs updates</strong> — Your profile needs updates before going live. Check your email for instructions from our team.
          </p>
        </div>
      )}
      {isOwnProfile && candidate.admin_status === "approved" && (
        hiddenForId ? (
          <div className="bg-red-50 border-b border-red-200 px-6 py-3 text-center">
            <p className="text-sm text-red-800">
              <strong>Your profile is hidden from clients</strong> — your 14-day ID window has passed. Verify your ID and you&apos;re visible again immediately.{" "}
              <Link href="/verify-id" className="underline font-semibold">Verify now</Link>
            </p>
          </div>
        ) : (
          <div className="bg-green-50 border-b border-green-200 px-6 py-3 text-center">
            <p className="text-sm text-green-800">
              <strong>Your profile is live</strong> — You are visible to clients. You will be notified when a client sends you a message.
            </p>
          </div>
        )
      )}

      {/* Own profile continue-application CTA */}
      {isOwnProfile && (() => {
        const hasPassedTest = (candidate.english_mc_score ?? 0) >= 70;
        const hasRecordings = !!candidate.voice_recording_1_url && !!candidate.voice_recording_2_url;
        const profileDone = !!candidate.profile_photo_url && !!candidate.resume_url;
        const aiDone = !!candidate.ai_interview_completed_at;

        if (aiDone) return null;

        let label = "";
        let href = "/apply";

        if (!hasPassedTest && !hasRecordings) {
          label = candidate.english_mc_score ? "Continue English Test" : "Continue Application";
        } else if (hasPassedTest && !hasRecordings) {
          label = "Continue Application";
        } else if (hasRecordings && !profileDone) {
          label = "Continue Profile Setup";
        } else if (profileDone && !aiDone) {
          label = "Start AI Interview";
          href = `https://interview.staffva.com?token=${ownInterviewToken}`;
        }

        if (!label) return null;

        return (
          <div className="bg-orange-50 border-b border-orange-200 px-6 py-3 text-center">
            <a
              href={href}
              target={href.startsWith("http") ? "_blank" : undefined}
              rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
              className="inline-flex items-center gap-2 rounded-lg bg-[#FE6E3E] px-5 py-2 text-sm font-semibold text-white hover:bg-[#E55A2B] transition-colors"
            >
              {label} →
            </a>
          </div>
        );
      })()}

      {/* ── Recruiting manager actions bar (functional, kept verbatim) ── */}
      {isRecruitingManager && (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-3">
          <div className="mx-auto max-w-5xl flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Recruiting Manager View</p>
              <p className="text-xs text-amber-700 mt-0.5">
                Status: <strong>{candidate.admin_status?.replace(/_/g, " ")}</strong>
                {" · "}AI interview: <strong>{aiInterviewCompleted ? "completed" : "not completed"}</strong>
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <ApproveButton
                candidateId={candidate.id}
                aiInterviewCompleted={aiInterviewCompleted}
                alreadyApproved={candidate.admin_status === "approved"}
              />
              <BanButton
                candidateId={candidate.id}
                candidateName={candidate.display_name || candidate.full_name}
                alreadyBanPending={!!candidate.ban_pending_review}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Breadcrumb ── */}
      <section className="profile-top">
        <div className="container">
          <div className="breadcrumb">
            <Link href="/">Home</Link><span>/</span>
            <Link href="/browse">Find Talent</Link><span>/</span>
            {displayedName}
          </div>
        </div>
      </section>

      {/* ── Profile hero ── */}
      <section className="container profile-hero">
        {/* Media column — the video's slot; the photo fills it when there is no video. */}
        <div className="profile-video-col">
          <div className="profile-video">
            <div className={`profile-video-bg ${hasApprovedVideo && canViewGated ? "has-player" : ""}`}>
              {hasApprovedVideo && canViewGated ? (
                <ProfileVideo path={candidate.video_intro_url} />
              ) : (
                <>
                  {candidate.profile_photo_url && (
                    <div className="profile-photo-fill" style={{ backgroundImage: `url(${candidate.profile_photo_url})` }} />
                  )}
                  {hasApprovedVideo && (
                    <div className="profile-video-lock">
                      {LOCK_ICON}
                      {isLoggedIn ? "VIDEO — CLIENT ACCOUNTS" : "SIGN UP TO WATCH"}
                    </div>
                  )}
                  {hasApprovedVideo && !isLoggedIn && (
                    <Link href="/signup/client" className="profile-video-play" aria-label="Create a free account to watch the video intro">
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><polygon points="8 5 19 12 8 19" /></svg>
                    </Link>
                  )}
                  <div className="profile-video-caption">
                    <div className="profile-video-caption-name">
                      {hasApprovedVideo ? "Video intro available" : displayedName}
                    </div>
                    <div className="profile-video-caption-sub">
                      {hasApprovedVideo ? "Reviewed and approved by StaffVA" : candidate.role_category}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Voice recordings — real assessments, gated like before */}
          {(canViewGated || isOwnProfile || isAdmin) ? (
            <>
              {candidate.voice_recording_1_url && (
                <VoiceCard path={candidate.voice_recording_1_url} label="Voice · Oral reading assessment" />
              )}
              {candidate.voice_recording_2_url && (
                <VoiceCard path={candidate.voice_recording_2_url} label="Voice · Professional introduction" />
              )}
            </>
          ) : (candidate.voice_recording_1_url || candidate.voice_recording_2_url) ? (
            <div className="voice-intro-btn" role="note">
              <div className="voice-intro-icon">
                <div className="voice-intro-wave"><span></span><span></span><span></span><span></span><span></span></div>
              </div>
              <div className="voice-intro-text">
                <div className="voice-intro-title">Voice introduction recorded</div>
                <div className="voice-intro-sub">
                  {isLoggedIn ? "Visible to client accounts" : "Create a free account to listen"}
                </div>
              </div>
              <div className="voice-intro-lock-icon">{LOCK_ICON}</div>
            </div>
          ) : null}
        </div>

        {/* Info column */}
        <div className="profile-info-col">
          <div className="profile-id-badges">
            <span className="id-badge">{candidate.role_category}</span>
            {idVerified && (
              <span className="id-badge">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg>
                ID VERIFIED
              </span>
            )}
            {isLive && aiInterviewCompleted && aiInterview?.passed && (
              <span className="id-badge">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                SKILLS INTERVIEW PASSED
              </span>
            )}
            {hasUSExperience && (
              <span className="id-badge">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                US CLIENT EXPERIENCE
              </span>
            )}
            {candidate.reputation_tier && ["Elite", "Top Rated", "Rising", "Established"].includes(candidate.reputation_tier) && (
              <span className="id-badge lime">★ {candidate.reputation_tier.toUpperCase()}</span>
            )}
          </div>

          <h1 className="profile-name">
            {displayedName}
            {isLive && (
              <span className="profile-name-verify" title="Verified by StaffVA">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </span>
            )}
          </h1>
          <div className="profile-role">{candidate.tagline || candidate.role_category}</div>
          <div className="profile-location">
            <span className="flag">{FLAGS[candidate.country || ""] || "🌍"}</span>
            {candidate.country}
            <span className="dot"></span>
            {humanizeTimeZone(candidate.time_zone)}
          </div>

          <div className="profile-stats-row">
            <div className="profile-stat">
              <div className="profile-stat-val">${Number(candidate.hourly_rate || 0)}<span>/hr</span></div>
              <div className="profile-stat-lbl">Rate</div>
            </div>
            <div className="profile-stat">
              <div className="profile-stat-val">
                {availabilityComputed === "unavailable" ? "Booked" : <>{remainingHours}<span> hrs/wk</span></>}
              </div>
              <div className="profile-stat-lbl">Available</div>
            </div>
            {candidate.years_experience ? (
              <div className="profile-stat">
                <div className="profile-stat-val">{candidate.years_experience}<span> yrs</span></div>
                <div className="profile-stat-lbl">Experience</div>
              </div>
            ) : null}
            <div className="profile-stat">
              <div className="profile-stat-val">{tierLabel ? tierLabel : "—"}</div>
              <div className="profile-stat-lbl">English level</div>
            </div>
          </div>

          {candidate.reputation_tier && candidate.reputation_percentile ? (
            <p className="profile-note" style={{ marginTop: "-8px", marginBottom: "18px" }}>
              Top {100 - candidate.reputation_percentile + 1}% of platform
            </p>
          ) : null}

          {/* Primary actions */}
          {isOwnProfile ? (
            <div className="profile-actions">
              <Link href="/apply" className="btn btn-primary">Edit Profile</Link>
            </div>
          ) : !isCandidate ? (
            <div className="profile-actions">
              {availabilityComputed === "unavailable" ? (
                <NotifyButton candidateId={candidate.id} isLoggedIn={isLoggedIn} />
              ) : isLoggedIn ? (
                <>
                  <Link href={`/inbox?candidate=${candidate.id}${clientId ? `&client=${clientId}` : ""}`} className="btn btn-primary">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                    Message
                  </Link>
                  <Link href={`/hire/${candidate.id}/offer`} className="btn btn-lime">
                    Hire {firstName}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/signup/client" className="btn btn-primary">
                    Create a free account to message {firstName}
                  </Link>
                  <Link href={`/login?next=/candidate/${candidate.id}`} className="btn btn-outline">Sign In</Link>
                </>
              )}
            </div>
          ) : null}
        </div>
      </section>

      {/* ── Verification strip — real checks only ── */}
      <section className="verify-strip">
        <div className="container">
          <div className="verify-grid">
            {idVerified && (
              <div className="verify-item">
                <div className="verify-icon-round green">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg>
                </div>
                <div className="verify-content">
                  <strong>ID Verified</strong>
                  Government ID check
                </div>
              </div>
            )}
            {tierLabel && (
              <div className="verify-item">
                <div className="verify-icon-round lime">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
                </div>
                <div className="verify-content with-val">
                  <strong>{tierLabel}</strong>
                  English (assessed)
                </div>
              </div>
            )}
            {isLive && aiInterviewCompleted && aiInterview?.passed && (
              <div className="verify-item">
                <div className="verify-icon-round green">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                </div>
                <div className="verify-content">
                  <strong>Skills interview</strong>
                  Structured &amp; monitored
                </div>
              </div>
            )}
            {earningsLabel && (
              <div className="verify-item">
                <div className="verify-icon-round green">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                </div>
                <div className="verify-content">
                  <strong>{earningsLabel}</strong>
                  Verified on-platform
                </div>
              </div>
            )}
            {isLive && (
              <div className="verify-item">
                <div className="verify-icon-round">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                </div>
                <div className="verify-content">
                  <strong>Vetted by StaffVA</strong>
                  Human-reviewed before going live
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Main layout ── */}
      <div className="container profile-layout">
        <div className="profile-main">

          {/* About */}
          {candidate.bio && (
            <section>
              <h2>About</h2>
              <div className="about-body">
                <p>{candidate.bio}</p>
              </div>
            </section>
          )}

          {/* Scorecard — real screening numbers, gated for real */}
          {hasScorecard && (
            <section>
              <h2>Scorecard</h2>
              {!canViewGated ? (
                <div className="lock-note">
                  {LOCK_ICON}
                  {isLoggedIn ? "Screening results are visible to client accounts." : "Create a free account to view the screening results."}
                </div>
              ) : (
                <>
                  {englishRows.length > 0 && (
                    <div className="scorecard-block">
                      <h3>English assessment</h3>
                      {englishRows.map((r) => (
                        <div className="score-row" key={r.label}>
                          <div className="score-label">{r.label}</div>
                          <div className="score-bar"><div className="score-fill" style={{ width: `${Math.min(r.score, 100)}%` }}></div></div>
                          <div className="score-val">{r.score}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {interviewRows.length > 0 && (
                    <div className="scorecard-block">
                      <h3>Skills interview{aiInterview?.overall_score ? ` · ${aiInterview.overall_score}/100 overall` : ""}</h3>
                      {interviewRows.map((r) => (
                        <div key={r.label}>
                          <div className="score-row">
                            <div className="score-label">{r.label}</div>
                            <div className="score-bar"><div className="score-fill amber" style={{ width: `${Math.min(r.score, 100)}%` }}></div></div>
                            <div className="score-val">{r.score}</div>
                          </div>
                          {r.feedback && <p className="score-feedback">{r.feedback}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                  {textBlocks.length > 0 && (
                    <div className="scorecard-block">
                      {textBlocks.map((b) => (
                        <div key={b.label}>
                          <h3>{b.label}</h3>
                          <p className="scorecard-note">{b.value}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="profile-note">
                    Scores come from StaffVA&apos;s structured, monitored screening and are locked — candidates can&apos;t edit them.
                  </p>
                </>
              )}
            </section>
          )}

          {/* Work samples — real portfolio uploads */}
          {(portfolioItems || []).length > 0 && (
            <section>
              <h2>Work samples{canViewGated && <span className="count">{portfolioItems!.length} {portfolioItems!.length === 1 ? "item" : "items"}</span>}</h2>
              {canViewGated ? (
                <div className="edu-grid">
                  {portfolioItems!.map((item) => (
                    <a key={item.id} href={item.file_url} target="_blank" rel="noopener noreferrer" className="edu-item" style={{ display: "block" }}>
                      <div className="edu-head">
                        <div className="edu-school">{item.description || "Portfolio item"}</div>
                        <div className="edu-date" style={{ textTransform: "uppercase" }}>{item.file_type}</div>
                      </div>
                      <div className="edu-degree">Open in a new tab ↗</div>
                    </a>
                  ))}
                </div>
              ) : (
                <div className="lock-note">
                  {LOCK_ICON}
                  {isLoggedIn ? "Portfolio visible to client accounts." : "Create a free account to view the portfolio."}
                </div>
              )}
            </section>
          )}

          {/* Work history */}
          {workExperience.length > 0 && (
            <section>
              <h2>Work history</h2>
              <div className="work-timeline">
                {workExperience.map((entry, i) => {
                  const isCurrent = !entry.end_date || entry.end_date === "present";
                  return (
                    <div key={i} className={`work-entry ${isCurrent && i === 0 ? "current" : ""}`}>
                      <div className="work-dot"></div>
                      <div className="work-body">
                        <div className="work-header">
                          <div className="work-company">
                            {entry.company_name && entry.company_name !== entry.role_title ? entry.company_name : entry.role_title}
                          </div>
                          {entry.duration && <div className="work-dates">{entry.duration}</div>}
                        </div>
                        <div className="work-role">
                          {entry.company_name && entry.company_name !== entry.role_title ? entry.role_title : entry.industry}
                          {entry.company_name && entry.company_name !== entry.role_title && entry.industry ? ` · ${entry.industry}` : ""}
                        </div>
                        {entry.description && <p className="work-desc">{entry.description}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Reviews — real ones only */}
          {(reviews || []).length > 0 && (
            <section>
              <h2>Reviews <span className="count">{reviews!.length} {reviews!.length === 1 ? "review" : "reviews"} · from clients who hired via StaffVA</span></h2>
              <div className="reviews-aggregate">
                <div>
                  <div className="agg-big-num">{avgRating} <span className="agg-big-stars">{"★".repeat(Math.round(Number(avgRating)))}</span></div>
                  <div className="agg-big-sub">{reviews!.length} {reviews!.length === 1 ? "review" : "reviews"} · every review requires a completed escrow payment</div>
                </div>
              </div>
              {reviews!.map((review, idx) => (
                <div className="review-card" key={idx}>
                  <div className="review-head">
                    <div className="review-right" style={{ textAlign: "left" }}>
                      <div className="review-stars">{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</div>
                    </div>
                  </div>
                  {review.body && <p className="review-body">{review.body}</p>}
                  <div className="review-footer">
                    <span>{new Date(review.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase()}</span>
                    <span className="review-platform-note">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                      Verified engagement
                    </span>
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* Skills & tools */}
          {(skills.length > 0 || tools.length > 0) && (
            <section>
              <h2>Skills &amp; tools</h2>
              <div className="skills-cols">
                {skills.length > 0 && (
                  <div>
                    <h3>Core skills</h3>
                    <div className="skills-list">
                      {skills.map((s) => (
                        <div className="skill-row" key={s}><span className="skill-name">{s}</span></div>
                      ))}
                    </div>
                  </div>
                )}
                {tools.length > 0 && (
                  <div>
                    <h3>Tools</h3>
                    <div className="comm-tags">
                      {tools.map((t) => (
                        <span className="comm-tag" key={t}>{t}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Availability + details */}
          <section>
            <h2>Availability</h2>
            <div className="availability-block">
              <div className="availability-status">
                <span className="availability-dot" style={availabilityComputed === "unavailable" ? { background: "#9a9689" } : availabilityComputed === "partial" ? { background: "var(--amber)" } : undefined}></span>
                <div>
                  <div className="availability-title">
                    {availabilityComputed === "available"
                      ? "Available now"
                      : availabilityComputed === "partial"
                      ? `Partially available — ${remainingHours} hrs/week remaining`
                      : "Fully booked"}
                  </div>
                  <div className="availability-sub">
                    {humanizeTimeZone(candidate.time_zone)}
                    {candidate.us_client_experience && US_EXPERIENCE_LABELS[candidate.us_client_experience]
                      ? ` · ${US_EXPERIENCE_LABELS[candidate.us_client_experience]}`
                      : ""}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* ── Sidebar ── */}
        <aside className="profile-sidebar">
          {isOwnProfile ? (
            <>
              <div className="sidebar-title">Your listing</div>
              <div className="sidebar-rate">${Number(candidate.hourly_rate || 0)}<span>/hr</span></div>
              <div className="sidebar-sub">This is what clients see.</div>
              <div className="sidebar-quick">
                {earningsLabel && (
                  <div className="sidebar-quick-row">
                    <span className="sidebar-quick-lbl">Earned on StaffVA</span>
                    <span className="sidebar-quick-val" style={{ color: "#17A05B" }}>{earningsLabel}</span>
                  </div>
                )}
                {(tenureBadges || []).length > 0 && (
                  <div className="sidebar-quick-row">
                    <span className="sidebar-quick-lbl">Tenure</span>
                    <span className="sidebar-quick-val">{(tenureBadges || []).map((b) => b.badge_type.replace(/_/g, " ")).join(", ")}</span>
                  </div>
                )}
              </div>
              <div className="sidebar-actions">
                <Link href="/apply" className="btn btn-primary">Edit Profile</Link>
              </div>
            </>
          ) : (
            <>
              <div className="sidebar-title">Hire {firstName}</div>
              <div className="sidebar-rate">${Number(candidate.hourly_rate || 0)}<span>/hr</span></div>
              {weeklyRate && <div className="sidebar-sub">${weeklyRate}/wk at 40 hrs · escrow protected</div>}

              <div className="sidebar-quick">
                <div className="sidebar-quick-row">
                  <span className="sidebar-quick-lbl">Availability</span>
                  <span className="sidebar-quick-val">
                    <span className={`avail-dot ${availabilityComputed === "available" ? "avail-now" : ""}`}></span>
                    {availabilityComputed === "available" ? "Now" : availabilityComputed === "partial" ? `${remainingHours} hrs/wk` : "Booked"}
                  </span>
                </div>
                <div className="sidebar-quick-row">
                  <span className="sidebar-quick-lbl">Country</span>
                  <span className="sidebar-quick-val">{candidate.country || "—"}</span>
                </div>
                {tierLabel && (
                  <div className="sidebar-quick-row">
                    <span className="sidebar-quick-lbl">English</span>
                    <span className="sidebar-quick-val">{tierLabel}</span>
                  </div>
                )}
                {earningsLabel && (
                  <div className="sidebar-quick-row">
                    <span className="sidebar-quick-lbl">Earned on StaffVA</span>
                    <span className="sidebar-quick-val" style={{ color: "#17A05B" }}>{earningsLabel}</span>
                  </div>
                )}
                {(tenureBadges || []).length > 0 && (
                  <div className="sidebar-quick-row">
                    <span className="sidebar-quick-lbl">Tenure</span>
                    <span className="sidebar-quick-val">{(tenureBadges || []).map((b) => b.badge_type.replace(/_/g, " ")).join(", ")}</span>
                  </div>
                )}
              </div>

              {!isCandidate && (
                <div className="sidebar-actions">
                  {availabilityComputed === "unavailable" ? (
                    <NotifyButton candidateId={candidate.id} isLoggedIn={isLoggedIn} />
                  ) : isLoggedIn ? (
                    <>
                      <Link href={`/hire/${candidate.id}/offer`} className="btn btn-lime">
                        Hire {firstName}
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
                      </Link>
                      <Link href={`/inbox?candidate=${candidate.id}${clientId ? `&client=${clientId}` : ""}`} className="btn btn-primary">
                        Message {firstName}
                      </Link>
                    </>
                  ) : (
                    <Link href="/signup/client" className="btn btn-lime">Create a free account</Link>
                  )}
                </div>
              )}
            </>
          )}

          {/* Interview booking — the existing scheduler, unchanged */}
          {!isOwnProfile && !isCandidate && (
            <div style={{ marginTop: "18px" }}>
              <InterviewScheduler
                candidateId={candidate.id}
                candidateFirstName={firstName}
                candidateTz={candidate.time_zone || "UTC"}
                isLoggedIn={isLoggedIn}
                clientId={clientId}
                profilePath={`/candidate/${candidate.id}`}
              />
            </div>
          )}

          {/* Admin-only extras */}
          {isAdmin && (candidate.linkedin_url || candidate.resume_url) && (
            <div className="sidebar-quick" style={{ marginTop: "18px" }}>
              <div className="sidebar-quick-row">
                <span className="sidebar-quick-lbl">Admin only</span>
                <span className="sidebar-quick-val" style={{ display: "flex", gap: "10px" }}>
                  {candidate.linkedin_url && (
                    <a href={candidate.linkedin_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>LinkedIn</a>
                  )}
                  {candidate.resume_url && (
                    <a href={candidate.resume_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>Resume</a>
                  )}
                </span>
              </div>
            </div>
          )}
        </aside>
      </div>

      <AtlasFooter />

      {/* ── Floating hire pill — appears on scroll, clients only ── */}
      {!isOwnProfile && !isCandidate && candidate.admin_status === "approved" && isClient && (
        <>
          <div className="profile-sticky-footer">
            <div className="sticky-footer-info">
              <div
                className="sticky-footer-avatar"
                style={candidate.profile_photo_url ? { backgroundImage: `url(${candidate.profile_photo_url})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
              >
                {candidate.profile_photo_url ? "" : (displayedName || "?").charAt(0)}
              </div>
              <div className="sticky-footer-text">
                <div className="sticky-footer-name">{displayedName}</div>
                <div className="sticky-footer-rate">${Number(candidate.hourly_rate || 0)}/hr</div>
              </div>
            </div>
            <div className="sticky-footer-actions">
              <Link href={`/hire/${candidate.id}/offer`} className="btn btn-lime">Hire {firstName}</Link>
            </div>
          </div>
        </>
      )}
      <ProfileInteractive />
    </div>
  );
}
