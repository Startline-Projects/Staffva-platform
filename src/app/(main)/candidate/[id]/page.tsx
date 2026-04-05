import { createClient } from "@supabase/supabase-js";
import { getUser } from "@/lib/auth";
import Link from "next/link";
import MessageButton from "@/components/browse/MessageButton";
import InterviewRequestSection from "@/components/InterviewRequestSection";
import NotifyButton from "@/components/browse/NotifyButton";
import ServicePurchaseSection from "@/components/ServicePurchaseSection";
import ProfileViewTracker from "@/components/ProfileViewTracker";

async function InterviewNotesPDF({ path }: { path: string }) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let pdfUrl = path;
  if (!path.startsWith("http")) {
    const { data } = await supabase.storage
      .from("interview-notes")
      .createSignedUrl(path, 3600);
    pdfUrl = data?.signedUrl || "";
  }

  if (!pdfUrl) return null;

  return (
    <a
      href={pdfUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-3 inline-flex items-center gap-2 rounded-lg border border-purple-200 bg-white px-4 py-2 text-xs font-medium text-purple-700 hover:bg-purple-50 transition-colors"
    >
      <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">PDF</span>
      Download Interview Notes
    </a>
  );
}

async function AudioPlayerServer({ bucket, path, label }: { bucket: string; path: string; label: string }) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let audioUrl = path;

  // If it's a storage path (not a full URL), generate a signed URL
  if (!path.startsWith("http")) {
    const { data } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, 3600);
    audioUrl = data?.signedUrl || "";
  }

  if (!audioUrl) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold text-text/40 uppercase tracking-wider mb-3">{label}</p>
        <p className="text-xs text-text/40 italic">Audio unavailable</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold text-text/40 uppercase tracking-wider mb-3">{label}</p>
      <audio controls src={audioUrl} className="w-full h-10" preload="metadata" />
    </div>
  );
}

async function VideoPlayerSection({ bucket, path }: { bucket: string; path: string }) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let videoUrl = path;
  if (!path.startsWith("http")) {
    const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
    videoUrl = data?.signedUrl || "";
  }

  if (!videoUrl) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold text-text/40 uppercase tracking-wider mb-1">Video Introduction</p>
      <p className="text-[10px] text-text-tertiary mb-3">Reviewed and approved by StaffVA</p>
      <div className="rounded-lg overflow-hidden bg-black">
        <video controls playsInline src={videoUrl} className="w-full aspect-video" preload="metadata" />
      </div>
      <p className="mt-2 text-[10px] text-text-tertiary">This video was reviewed by our team to confirm it meets StaffVA professional standards.</p>
    </div>
  );
}

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const TIER_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  exceptional: { label: "Exceptional", color: "text-white", bg: "bg-emerald-600" },
  advanced: { label: "Advanced", color: "text-white", bg: "bg-blue-600" },
  professional: { label: "Professional", color: "text-white", bg: "bg-gray-500" },
};

const SPEAKING_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  fluent: { label: "Fluent", color: "text-white", bg: "bg-emerald-600" },
  proficient: { label: "Proficient", color: "text-white", bg: "bg-blue-600" },
  conversational: { label: "Conversational", color: "text-white", bg: "bg-amber-600" },
  developing: { label: "Developing", color: "text-white", bg: "bg-gray-500" },
};

const US_EXPERIENCE_LABELS: Record<string, string> = {
  full_time: "Full-time US client experience",
  part_time_contract: "Part-time / contract US experience",
  international_only: "International client experience",
  none: "No prior US client experience",
};

export default async function CandidateProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getAdminClient();
  const user = await getUser();
  const isLoggedIn = !!user;
  const isClient = user?.user_metadata?.role === "client";
  const isCandidate = user?.user_metadata?.role === "candidate";
  const isAdmin = user?.user_metadata?.role === "admin";

  // First try to find approved candidate (public view)
  let { data: candidate } = await supabase
    .from("candidates")
    .select("*")
    .eq("id", id)
    .eq("admin_status", "approved")
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
      <div className="flex min-h-[calc(100vh-73px)] items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-text">Access Restricted</h1>
          <p className="mt-2 text-sm text-text/60">Candidate accounts cannot view other profiles.</p>
          <Link href="/apply" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 transition-colors">
            Go to My Application
          </Link>
        </div>
      </div>
    );
  }

  // If not found and user is admin, show any candidate
  if (!candidate && isAdmin) {
    const { data: adminCandidate } = await supabase
      .from("candidates")
      .select("*")
      .eq("id", id)
      .single();

    if (adminCandidate) {
      candidate = adminCandidate;
    }
  }

  if (!candidate) {
    return (
      <div className="flex min-h-[calc(100vh-73px)] items-center justify-center bg-background">
        <div className="text-center">
          <svg className="mx-auto w-16 h-16 text-text/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <h1 className="mt-4 text-2xl font-bold text-text">Profile Not Found</h1>
          <p className="mt-2 text-sm text-text/60">This candidate may no longer be available.</p>
          <Link href="/browse" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 transition-colors">
            &larr; Browse Talent
          </Link>
        </div>
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
    if (client) {
      clientId = client.id;
    }
  }

  // Compute availability from committed_hours
  const committedHours = candidate.committed_hours || 0;
  const availabilityComputed = committedHours === 0
    ? "available"
    : committedHours < 40
    ? "partial"
    : "unavailable";
  const remainingHours = 50 - committedHours;

  // Fetch completed interviews
  const { data: completedInterviews } = await supabase
    .from("candidate_interviews")
    .select("*")
    .eq("candidate_id", id)
    .eq("status", "completed")
    .order("interview_number");

  const interviewCount = completedInterviews?.length || 0;

  // Fetch completed AI interview (latest)
  const { data: aiInterview } = await supabase
    .from("ai_interviews")
    .select("overall_score, technical_knowledge_score, problem_solving_score, communication_score, experience_depth_score, professionalism_score, status, passed, badge_level")
    .eq("candidate_id", id)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const tier = candidate.english_written_tier ? TIER_CONFIG[candidate.english_written_tier] : null;
  const speaking = candidate.speaking_level ? SPEAKING_CONFIG[candidate.speaking_level] : null;
  const hasUSExperience = candidate.us_client_experience === "full_time" || candidate.us_client_experience === "part_time_contract";
  const displayedName = candidate.display_name || candidate.full_name;
  const canViewGated = isLoggedIn && (isClient || isOwnProfile || isAdmin);
  const tools: string[] = candidate.tools || [];
  const workExperience: { role_title: string; industry: string; duration: string; description: string }[] = candidate.work_experience || [];

  // Fetch active service packages
  const { data: servicePackages } = await supabase
    .from("service_packages")
    .select("*")
    .eq("candidate_id", id)
    .eq("status", "active")
    .order("price_usd", { ascending: true });

  const { data: portfolioItems } = await supabase
    .from("portfolio_items")
    .select("*")
    .eq("candidate_id", id)
    .order("display_order");

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

  return (
    <div className="min-h-screen bg-background">
      {/* Track profile view for logged-in clients */}
      {isClient && !isOwnProfile && <ProfileViewTracker candidateId={id} />}

      {/* Status banner for own profile — reads actual admin_status */}
      {isOwnProfile && candidate.admin_status === "pending_speaking_review" && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 text-center">
          <p className="text-sm text-amber-800">
            <strong>Profile under review</strong> — Your profile is complete and under review. We will notify you within 2 business days once your speaking assessment is complete and your profile goes live.
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
        <div className="bg-green-50 border-b border-green-200 px-6 py-3 text-center">
          <p className="text-sm text-green-800">
            <strong>Your profile is live</strong> — You are visible to clients. You will be notified when a client sends you a message.
          </p>
        </div>
      )}

      {/* Own profile action button — visible only to the candidate viewing their own profile */}
      {isOwnProfile && (() => {
        const hasPassedTest = (candidate.english_mc_score ?? 0) >= 70;
        const hasRecordings = !!candidate.voice_recording_1_url && !!candidate.voice_recording_2_url;
        const profileDone = !!candidate.profile_photo_url && !!candidate.resume_url;
        const aiDone = (completedInterviews || []).some((i: { interview_number: number }) => i.interview_number === 1);

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
          href = `https://interview.staffva.com?candidate=${candidate.id}`;
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

      {/* ═══════════ HEADER — Dark Charcoal ═══════════ */}
      <div className="bg-[#1C1B1A]">
        <div className="mx-auto max-w-5xl px-6 py-4">
          <Link href={isOwnProfile ? "/apply" : "/browse"} className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {isOwnProfile ? "Back to Application" : "Back to Browse"}
          </Link>
        </div>

        <div className="mx-auto max-w-5xl px-6 pb-10">
          {/* No lock banner — profiles always visible */}

          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
            <div className="flex items-start gap-5">
              {/* Profile photo */}
              <div className="flex-shrink-0 h-20 w-20 rounded-full overflow-hidden border-2 border-white/20 bg-white/10">
                {candidate.profile_photo_url ? (
                  <img
                    src={candidate.profile_photo_url}
                    alt={displayedName || ""}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <span className="text-3xl font-bold text-white/60">
                      {candidate.display_name?.charAt(0) || "?"}
                    </span>
                  </div>
                )}
              </div>

              <div>
                <h1 className="text-2xl font-bold text-white">{displayedName}</h1>
                <p className="mt-0.5 text-white/50">{candidate.country}</p>
                {candidate.tagline && (
                  <p className="mt-2 text-sm text-white/70">{candidate.tagline}</p>
                )}

                {/* Badges */}
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white">
                    {candidate.role_category}
                  </span>
                  {tier && (
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tier.bg} ${tier.color}`}>
                      English: {tier.label}
                    </span>
                  )}
                  {speaking && (
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${speaking.bg} ${speaking.color}`}>
                      Speaking: {speaking.label}
                    </span>
                  )}
                  {hasUSExperience && (
                    <span className="rounded-full bg-green-600 px-3 py-1 text-xs font-semibold text-white">
                      US Experience
                    </span>
                  )}
                  {interviewCount > 0 && (
                    <span className="rounded-full bg-purple-600 px-3 py-1 text-xs font-semibold text-white">
                      {interviewCount === 1 ? "Interviewed Once by StaffVA" : "Interviewed Twice by StaffVA"}
                    </span>
                  )}
                  {candidate.reputation_tier === "Elite" && (
                    <span className="rounded-full bg-amber-700 px-3 py-1 text-xs font-semibold text-amber-100">
                      Elite
                    </span>
                  )}
                  {candidate.reputation_tier === "Top Rated" && (
                    <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white">
                      Top Rated
                    </span>
                  )}
                  {candidate.reputation_tier === "Rising" && (
                    <span className="rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white">
                      Rising
                    </span>
                  )}
                  {candidate.reputation_tier === "Established" && (
                    <span className="rounded-full bg-gray-500 px-3 py-1 text-xs font-semibold text-white">
                      Established
                    </span>
                  )}
                </div>
                {candidate.reputation_tier && candidate.reputation_percentile && (
                  <p className="mt-2 text-xs text-white/50">
                    Top {100 - candidate.reputation_percentile + 1}% of platform
                  </p>
                )}
              </div>
            </div>

            {/* Rate + availability */}
            <div className="text-right flex-shrink-0">
              <p className="text-4xl font-bold text-primary">
                ${candidate.hourly_rate?.toLocaleString()}
              </p>
              <p className="text-xs text-white/40 mt-1">per month</p>
              <div className="mt-3">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                  availabilityComputed === "available"
                    ? "bg-green-500/20 text-green-400"
                    : availabilityComputed === "partial"
                    ? "bg-amber-500/20 text-amber-400"
                    : "bg-white/10 text-white/50"
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${
                    availabilityComputed === "available" ? "bg-green-400"
                    : availabilityComputed === "partial" ? "bg-amber-400"
                    : "bg-gray-400"
                  }`} />
                  {availabilityComputed === "available"
                    ? "Available"
                    : availabilityComputed === "partial"
                    ? `Available — ${remainingHours} hrs/week remaining`
                    : "Not Available — Currently Engaged"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════ AUDIO PLAYERS ═══════════ */}
      <div className="mx-auto max-w-5xl px-6 -mt-6">
        {(canViewGated || isOwnProfile || isAdmin) ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {candidate.voice_recording_1_url && (
              <AudioPlayerServer
                bucket="voice-recordings"
                path={candidate.voice_recording_1_url}
                label="Oral Reading Assessment"
              />
            )}
            {candidate.voice_recording_2_url && (
              <AudioPlayerServer
                bucket="voice-recordings"
                path={candidate.voice_recording_2_url}
                label="Professional Introduction"
              />
            )}
          </div>
        ) : (candidate.voice_recording_1_url || candidate.voice_recording_2_url) ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-5 text-center">
              <svg className="mx-auto w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <p className="mt-2 text-xs text-text/40">Oral Reading Assessment</p>
              <p className="mt-1 text-xs text-primary">
                {isLoggedIn ? "Visible to client accounts" : "Create a free account to listen"}
              </p>
            </div>
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-5 text-center">
              <svg className="mx-auto w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <p className="mt-2 text-xs text-text/40">Professional Introduction</p>
              <p className="mt-1 text-xs text-primary">
                {isLoggedIn ? "Visible to client accounts" : "Create a free account to listen"}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {/* ═══════════ VIDEO INTRODUCTION ═══════════ */}
      {candidate.video_intro_status === "approved" && candidate.video_intro_url && (
        <div className="mx-auto max-w-5xl px-6 mt-6">
          {canViewGated ? (
            <VideoPlayerSection bucket="video-intros" path={candidate.video_intro_url} />
          ) : (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center">
              <svg className="mx-auto w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <p className="mt-2 text-sm text-text/60">Sign in to watch this professional&apos;s video introduction</p>
              <Link href="/login" className="mt-2 inline-block text-sm text-primary hover:underline">
                Create a free account
              </Link>
            </div>
          )}
        </div>
      )}

      {/* ═══════════ AI ASSESSMENT SCORES ═══════════ */}
      {candidate.admin_status === "approved" && (() => {
        const hasAiInterview = aiInterview && aiInterview.passed && aiInterview.overall_score;
        const hasEnglishScores = candidate.english_mc_score > 0 && candidate.english_comprehension_score > 0;

        if (!hasAiInterview && !hasEnglishScores) return null;

        const dimensions = hasAiInterview ? [
          { label: "Technical Knowledge", score: Math.round((aiInterview.technical_knowledge_score || 0) * 5) },
          { label: "Problem Solving", score: Math.round((aiInterview.problem_solving_score || 0) * 5) },
          { label: "Communication", score: Math.round((aiInterview.communication_score || 0) * 5) },
          { label: "Experience Depth", score: Math.round((aiInterview.experience_depth_score || 0) * 5) },
          { label: "Professionalism", score: Math.round((aiInterview.professionalism_score || 0) * 5) },
        ] : [
          { label: "Reading", score: Math.round(candidate.english_comprehension_score || 0) },
          { label: "Language", score: Math.round(candidate.english_mc_score || 0) },
        ];

        const overallScore = hasAiInterview ? aiInterview.overall_score : null;
        const overallBorder = overallScore && overallScore >= 80 ? "border-primary" : overallScore && overallScore >= 60 ? "border-amber-500" : "border-gray-300";
        const overallText = overallScore && overallScore >= 80 ? "text-primary" : overallScore && overallScore >= 60 ? "text-amber-600" : "text-gray-400";

        return (
          <div className="mx-auto max-w-5xl px-6 mt-6">
            <div className="rounded-xl border border-gray-200 bg-white p-6 group/assessment relative">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-text/40 uppercase tracking-wider">AI Assessment Results</h2>
                  <p className="mt-1 text-xs text-text-tertiary">
                    {hasAiInterview ? "Full AI interview assessment — 5 dimensions" : "English language assessment"}
                  </p>
                </div>
                {overallScore && (
                  <div className={`flex h-14 w-14 items-center justify-center rounded-full border-[3px] ${overallBorder}`}>
                    <span className={`text-lg font-bold ${overallText}`}>{overallScore}</span>
                  </div>
                )}
              </div>

              {/* Score bars */}
              <div className="mt-5 space-y-3">
                {dimensions.map((d) => (
                  <div key={d.label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-text-secondary">{d.label}</span>
                      <span className="text-xs font-semibold text-text tabular-nums">{d.score}/100</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-gray-100">
                      <div
                        className="h-2 rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${Math.min(d.score, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Tooltip */}
              <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden w-72 rounded-lg bg-charcoal px-4 py-2.5 text-xs text-white shadow-lg group-hover/assessment:block z-10 text-center">
                Scores are generated by AI-administered assessments and verified by our team. They are locked and cannot be edited by the candidate.
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-charcoal" />
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══════════ INTERVIEW REQUEST ═══════════ */}
      {!isOwnProfile && !isCandidate && candidate.admin_status === "approved" && (
        <div className="mx-auto max-w-5xl px-6 mt-6">
          <InterviewRequestSection
            candidateId={candidate.id}
            candidateName={candidate.display_name || candidate.full_name}
            isLoggedIn={isLoggedIn}
            isClient={isClient}
          />
        </div>
      )}

      {/* ═══════════ MAIN CONTENT — 2/3 + 1/3 ═══════════ */}
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* LEFT — 2/3 */}
          <div className="lg:col-span-2 space-y-6">

            {/* About */}
            {candidate.bio && (
              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <h2 className="text-sm font-semibold text-text/40 uppercase tracking-wider">About</h2>
                <p className="mt-3 text-sm leading-relaxed text-text/80">{candidate.bio}</p>
              </div>
            )}

            {/* Tools & Software */}
            {tools.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <h2 className="text-sm font-semibold text-text/40 uppercase tracking-wider">Tools & Software</h2>
                <div className="mt-4 flex flex-wrap gap-2">
                  {tools.map((tool: string) => (
                    <span
                      key={tool}
                      className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Work Experience */}
            {workExperience.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <h2 className="text-sm font-semibold text-text/40 uppercase tracking-wider">Work Experience</h2>
                <div className="mt-4 space-y-5">
                  {workExperience.map((entry, i) => (
                    <div key={i} className="relative pl-6 border-l-2 border-primary/20">
                      <div className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-primary" />
                      <p className="font-semibold text-text text-sm">{entry.role_title}</p>
                      <p className="text-xs text-text/50 mt-0.5">
                        {entry.industry} &middot; {entry.duration}
                      </p>
                      {entry.description && (
                        <p className="mt-1 text-sm text-text/70">{entry.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Services — active packages */}
            {(servicePackages || []).length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <h2 className="text-sm font-semibold text-text/40 uppercase tracking-wider flex items-center gap-2">
                  <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  Services
                </h2>
                <div className="mt-4 grid grid-cols-1 gap-4">
                  {(servicePackages || []).map((pkg: { id: string; title: string; description: string; whats_included: string[]; delivery_days: number; price_usd: number; tier: string; category: string; max_concurrent_orders: number }) => (
                    <div key={pkg.id} className="rounded-lg border border-gray-200 p-5 hover:border-primary/30 transition-colors">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-text">{pkg.title}</h3>
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary capitalize">
                              {pkg.tier}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-text/50">{pkg.category}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold text-primary">${Number(pkg.price_usd).toFixed(0)}</p>
                          <p className="text-[10px] text-text/40">+ 10% fee</p>
                        </div>
                      </div>

                      <p className="mt-3 text-sm text-text/70">{pkg.description}</p>

                      <div className="mt-3">
                        <ul className="space-y-1">
                          {(pkg.whats_included || []).slice(0, 3).map((item: string, i: number) => (
                            <li key={i} className="flex items-center gap-2 text-sm text-text/70">
                              <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                              {item}
                            </li>
                          ))}
                          {(pkg.whats_included || []).length > 3 && (
                            <li className="text-xs text-text/40 pl-5">
                              +{(pkg.whats_included || []).length - 3} more items
                            </li>
                          )}
                        </ul>
                      </div>

                      <div className="mt-4 flex items-center justify-between">
                        <span className="flex items-center gap-1 text-xs text-text/50">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {pkg.delivery_days} day{pkg.delivery_days !== 1 ? "s" : ""} delivery
                        </span>

                        {isClient ? (
                          <ServicePurchaseSection
                            packageId={pkg.id}
                            packageTitle={pkg.title}
                            packagePrice={Number(pkg.price_usd)}
                            deliveryDays={pkg.delivery_days}
                            whatsIncluded={pkg.whats_included || []}
                            candidateName={displayedName || ""}
                          />
                        ) : !isLoggedIn ? (
                          <Link
                            href="/signup/client"
                            className="rounded-lg border border-primary px-4 py-1.5 text-xs font-semibold text-primary hover:bg-primary hover:text-white transition-colors"
                          >
                            Sign in to purchase
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Interview Notes — visible to logged-in clients and admin only */}
            {(canViewGated || isAdmin) && completedInterviews && completedInterviews.length > 0 && (
              <div className="rounded-xl border border-purple-200 bg-white p-6">
                <h2 className="text-sm font-semibold text-text/40 uppercase tracking-wider flex items-center gap-2">
                  <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 3h1a2.25 2.25 0 012.25 2.25c0 .232-.035.45-.1.664M13.5 3c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664" />
                  </svg>
                  StaffVA Interview Notes
                </h2>
                <div className="mt-4 space-y-4">
                  {completedInterviews.map((interview: { interview_number: number; conducted_at: string; communication_score: number; demeanor_score: number; role_knowledge_score: number; speaking_level_updated_to: string; notes_pdf_url: string | null }) => (
                    <div key={interview.interview_number} className="rounded-lg bg-purple-50 border border-purple-100 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-text">
                          Interview {interview.interview_number}
                        </h3>
                        <span className="text-xs text-text/40">
                          {interview.conducted_at ? new Date(interview.conducted_at).toLocaleDateString() : ""}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-3 mb-3">
                        <div className="rounded bg-white p-2 text-center border border-purple-100">
                          <p className="text-[10px] text-text/40 uppercase">Communication</p>
                          <p className="text-lg font-bold text-purple-700">{interview.communication_score}/5</p>
                        </div>
                        <div className="rounded bg-white p-2 text-center border border-purple-100">
                          <p className="text-[10px] text-text/40 uppercase">Demeanor</p>
                          <p className="text-lg font-bold text-purple-700">{interview.demeanor_score}/5</p>
                        </div>
                        <div className="rounded bg-white p-2 text-center border border-purple-100">
                          <p className="text-[10px] text-text/40 uppercase">Role Knowledge</p>
                          <p className="text-lg font-bold text-purple-700">{interview.role_knowledge_score}/5</p>
                        </div>
                      </div>
                      <p className="text-xs text-text/50">
                        Speaking level assessed: <span className="font-medium capitalize text-text">{interview.speaking_level_updated_to}</span>
                      </p>
                      {interview.notes_pdf_url && (
                        <InterviewNotesPDF path={interview.notes_pdf_url} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Details */}
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <h2 className="text-sm font-semibold text-text/40 uppercase tracking-wider">Details</h2>
              <div className="mt-4 grid grid-cols-2 gap-y-4 gap-x-8">
                <div>
                  <p className="text-xs text-text/40">Experience</p>
                  <p className="mt-0.5 text-sm font-medium text-text">{candidate.years_experience}</p>
                </div>
                <div>
                  <p className="text-xs text-text/40">Time Zone</p>
                  <p className="mt-0.5 text-sm font-medium text-text">{candidate.time_zone}</p>
                </div>
                <div>
                  <p className="text-xs text-text/40">US Client Experience</p>
                  <p className="mt-0.5 text-sm font-medium text-text">
                    {US_EXPERIENCE_LABELS[candidate.us_client_experience] || "Not specified"}
                  </p>
                </div>
                {candidate.us_client_description && (
                  <div className="col-span-2">
                    <p className="text-xs text-text/40">US Work Description</p>
                    <p className="mt-0.5 text-sm text-text/70">{candidate.us_client_description}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Reviews */}
            {(reviews || []).length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-text/40 uppercase tracking-wider">Client Reviews</h2>
                  <span className="flex items-center gap-1 text-sm font-medium text-amber-600">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    {avgRating} avg
                  </span>
                </div>
                <div className="mt-4 space-y-3">
                  {reviews!.map((review, idx) => (
                    <div key={idx} className="rounded-lg bg-gray-50 p-4">
                      <div className="flex items-center gap-2">
                        <div className="flex gap-0.5">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <svg
                              key={star}
                              className={`w-4 h-4 ${star <= review.rating ? "text-amber-400" : "text-gray-200"}`}
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                            </svg>
                          ))}
                        </div>
                        <span className="text-xs text-text/40">
                          {new Date(review.submitted_at).toLocaleDateString()}
                        </span>
                      </div>
                      {review.body && <p className="mt-2 text-sm text-text/70">{review.body}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT — 1/3 Sticky sidebar */}
          <div className="lg:col-span-1">
            <div className="sticky top-24 space-y-4">

              {/* CTA Card — different for candidates vs clients */}
              {isOwnProfile ? (
                <div className="rounded-xl border border-gray-200 bg-white p-6">
                  <p className="text-center text-2xl font-bold text-primary">
                    ${candidate.hourly_rate?.toLocaleString()}
                    <span className="text-sm font-normal text-text/40">/hr</span>
                  </p>
                  <p className="mt-1 text-center text-xs text-text/40">Your listed rate</p>
                  <div className="mt-5">
                    <Link
                      href="/apply"
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                      </svg>
                      Edit Profile
                    </Link>
                  </div>
                </div>
              ) : !isCandidate ? (
                <div className="rounded-xl border border-gray-200 bg-white p-6">
                  <p className="text-center text-2xl font-bold text-primary">
                    ${candidate.hourly_rate?.toLocaleString()}
                    <span className="text-sm font-normal text-text/40">/hr</span>
                  </p>
                  <p className="mt-1 text-center text-xs text-text/40">per hour</p>
                  <div className="mt-5">
                    {availabilityComputed === "unavailable" ? (
                      <NotifyButton candidateId={candidate.id} isLoggedIn={isLoggedIn} />
                    ) : (
                      <MessageButton
                        candidateId={candidate.id}
                        candidateName={candidate.display_name}
                        isLoggedIn={isLoggedIn}
                        isLocked={false}
                        isLockingClient={false}
                        clientId={clientId}
                      />
                    )}
                  </div>
                </div>
              ) : null}

              {/* Verified info card */}
              <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-3">
                {Number(candidate.total_earnings_usd) > 0 && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text/40">Verified Earnings</span>
                      <span className="text-sm font-semibold text-green-600">
                        ${Number(candidate.total_earnings_usd).toLocaleString()}
                      </span>
                    </div>
                    <div className="border-t border-gray-100" />
                  </>
                )}

                {(tenureBadges || []).length > 0 && (
                  <>
                    <div>
                      <span className="text-xs text-text/40">Tenure Badges</span>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {(tenureBadges || []).map((badge) => (
                          <span key={badge.badge_type} className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-700">
                            {badge.badge_type.replace(/_/g, " ")}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="border-t border-gray-100" />
                  </>
                )}

                {hasUSExperience && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text/40">US Experience</span>
                      <span className="text-xs font-medium text-green-600">
                        {candidate.us_client_experience === "full_time" ? "Full-time" : "Part-time/Contract"}
                      </span>
                    </div>
                    <div className="border-t border-gray-100" />
                  </>
                )}

                {candidate.linkedin_url && isAdmin && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-text/30 mb-1">Admin Only</p>
                    <a href={candidate.linkedin_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-primary hover:text-orange-600 transition-colors">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                      </svg>
                      LinkedIn Profile
                    </a>
                  </div>
                )}
              </div>

              {/* Gated assets — portfolio + resume */}
              {/* Resume — admin only */}
              {isAdmin && candidate.resume_url && (
                <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
                  <p className="text-[10px] uppercase tracking-wider text-text/30">Admin Only — Internal Documents</p>
                  <a
                    href={candidate.resume_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded bg-red-100">
                      <span className="text-xs font-bold text-red-600">PDF</span>
                    </div>
                    <span className="text-sm font-medium text-text">Download Resume</span>
                  </a>
                </div>
              )}

              {/* Portfolio — visible to logged-in clients and admin */}
              {canViewGated ? (
                <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
                  {(portfolioItems || []).length > 0 ? (
                    <>
                      <p className="text-xs font-medium text-text/50 uppercase tracking-wider">Portfolio</p>
                      {(portfolioItems || []).map((item) => (
                        <a
                          key={item.id}
                          href={item.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/10">
                            <span className="text-xs font-bold uppercase text-primary">{item.file_type}</span>
                          </div>
                          <span className="text-sm text-text">{item.description || "Portfolio item"}</span>
                        </a>
                      ))}
                    </>
                  ) : (
                    <p className="text-xs text-text/40 text-center py-2">No portfolio items uploaded</p>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-5 text-center">
                  <svg className="mx-auto w-8 h-8 text-primary/30" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <p className="mt-2 text-xs text-text/50">
                    {isLoggedIn ? "Portfolio visible to client accounts." : "Create a free account to view portfolio."}
                  </p>
                  {!isLoggedIn && (
                    <Link
                      href="/signup/client"
                      className="mt-3 inline-flex rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-orange-600 transition-colors"
                    >
                      Create Free Account
                    </Link>
                  )}
                </div>
              )}

              {/* Trust signals */}
              <div className="rounded-xl bg-gray-50 p-5 space-y-3">
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <p className="text-xs text-text/60">English proficiency verified by StaffVA</p>
                </div>
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <p className="text-xs text-text/60">Speaking level verified by human reviewer</p>
                </div>
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <p className="text-xs text-text/60">Payments protected by escrow</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════ BOTTOM CTA — hidden for candidates ═══════════ */}
      {!isCandidate && (
        <div className="border-t border-gray-200 bg-white">
          <div className="mx-auto max-w-5xl px-6 py-6">
            {!isLoggedIn ? (
              <div className="text-center">
                <Link
                  href="/signup/client"
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-white hover:bg-orange-600 transition-colors"
                >
                  Sign in to message {candidate.display_name?.split(" ")[0]}
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* ═══════════ FIXED MOBILE HIRE BAR ═══════════ */}
      {!isOwnProfile && !isCandidate && candidate.admin_status === "approved" && isClient && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white px-4 py-3 md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom, 12px)" }}>
          <div className="flex items-center gap-4">
            <div className="shrink-0">
              <p className="text-lg font-bold text-primary">${candidate.hourly_rate?.toLocaleString()}<span className="text-xs font-normal text-text-muted">/hr</span></p>
            </div>
            <Link
              href={`/hire/${candidate.id}/offer`}
              className="flex-1 rounded-lg bg-primary py-3 text-center text-sm font-semibold text-white hover:bg-primary-dark transition-colors min-h-[44px] flex items-center justify-center"
            >
              Hire {candidate.display_name?.split(" ")[0]}
            </Link>
          </div>
        </div>
      )}
      {!isOwnProfile && !isCandidate && candidate.admin_status === "approved" && isClient && (
        <div className="h-20 md:hidden" />
      )}
    </div>
  );
}
