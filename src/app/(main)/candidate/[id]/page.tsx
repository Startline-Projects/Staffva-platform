import { createClient } from "@supabase/supabase-js";
import { getUser } from "@/lib/auth";
import Link from "next/link";
import MessageButton from "@/components/browse/MessageButton";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const TIER_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  exceptional: { label: "Exceptional", color: "text-white", bg: "bg-emerald-600" },
  proficient: { label: "Proficient", color: "text-white", bg: "bg-blue-600" },
  competent: { label: "Competent", color: "text-white", bg: "bg-gray-500" },
};

const SPEAKING_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  fluent: { label: "Fluent", color: "text-white", bg: "bg-emerald-600" },
  proficient: { label: "Proficient", color: "text-white", bg: "bg-blue-600" },
  conversational: { label: "Conversational", color: "text-white", bg: "bg-amber-600" },
  basic: { label: "Basic", color: "text-white", bg: "bg-gray-500" },
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
  let isLockingClient = false;

  if (isClient) {
    const { data: client } = await supabase
      .from("clients")
      .select("id")
      .eq("user_id", user!.id)
      .single();
    if (client) {
      clientId = client.id;
      isLockingClient = candidate.locked_by_client_id === client.id;
    }
  }

  const tier = candidate.english_written_tier ? TIER_CONFIG[candidate.english_written_tier] : null;
  const speaking = candidate.speaking_level ? SPEAKING_CONFIG[candidate.speaking_level] : null;
  const hasUSExperience = candidate.us_client_experience === "full_time" || candidate.us_client_experience === "part_time_contract";
  const isLocked = candidate.lock_status === "locked";
  const displayedName = isLockingClient ? candidate.full_name : candidate.display_name;
  const canViewGated = isLoggedIn && isClient;
  const tools: string[] = candidate.tools || [];
  const workExperience: { role_title: string; industry: string; duration: string; description: string }[] = candidate.work_experience || [];

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
      {/* Pending review banner for own profile */}
      {isOwnProfile && candidate.admin_status !== "approved" && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 text-center">
          <p className="text-sm text-amber-800">
            <strong>Profile under review</strong> — Your profile is not yet visible to clients. We will notify you once your speaking assessment is complete and your profile goes live.
          </p>
        </div>
      )}

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
          {/* Lock banner */}
          {isLocked && !isLockingClient && (
            <div className="mb-6 flex items-center gap-2 rounded-lg bg-white/10 px-4 py-3 text-sm text-white/70">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Currently engaged with another client
            </div>
          )}

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
                {isLockingClient && (
                  <p className="text-xs text-primary font-medium">Full name visible to you only</p>
                )}
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
                </div>
              </div>
            </div>

            {/* Rate + availability */}
            <div className="text-right flex-shrink-0">
              <p className="text-4xl font-bold text-primary">
                ${candidate.monthly_rate?.toLocaleString()}
              </p>
              <p className="text-xs text-white/40 mt-1">per month</p>
              {!isLocked && (
                <div className="mt-3">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                    candidate.availability_status === "available_now"
                      ? "bg-green-500/20 text-green-400"
                      : candidate.availability_status === "available_by_date"
                      ? "bg-amber-500/20 text-amber-400"
                      : "bg-white/10 text-white/50"
                  }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${
                      candidate.availability_status === "available_now" ? "bg-green-400" : "bg-amber-400"
                    }`} />
                    {candidate.availability_status === "available_now"
                      ? "Available Now"
                      : candidate.availability_status === "available_by_date"
                      ? `Available ${new Date(candidate.availability_date).toLocaleDateString()}`
                      : "Not Available"}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════ AUDIO PLAYERS ═══════════ */}
      <div className="mx-auto max-w-5xl px-6 -mt-6">
        {canViewGated ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {candidate.voice_recording_1_url && (
              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold text-text/40 uppercase tracking-wider mb-3">
                  Oral Reading Assessment
                </p>
                <audio controls src={candidate.voice_recording_1_url} className="w-full h-10" />
              </div>
            )}
            {candidate.voice_recording_2_url && (
              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold text-text/40 uppercase tracking-wider mb-3">
                  Professional Introduction
                </p>
                <audio controls src={candidate.voice_recording_2_url} className="w-full h-10" />
              </div>
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

              {/* CTA Card */}
              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <p className="text-center text-2xl font-bold text-primary">
                  ${candidate.monthly_rate?.toLocaleString()}
                  <span className="text-sm font-normal text-text/40">/mo</span>
                </p>
                <p className="mt-1 text-center text-xs text-text/40">+ 10% platform fee</p>
                <div className="mt-5">
                  <MessageButton
                    candidateId={candidate.id}
                    candidateName={candidate.display_name}
                    isLoggedIn={isLoggedIn}
                    isLocked={isLocked}
                    isLockingClient={isLockingClient}
                    clientId={clientId}
                  />
                </div>
              </div>

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

                {candidate.linkedin_url && (
                  <a href={candidate.linkedin_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-primary hover:text-orange-600 transition-colors">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                    </svg>
                    LinkedIn Profile
                  </a>
                )}
              </div>

              {/* Gated assets — portfolio + resume */}
              {canViewGated ? (
                <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
                  {candidate.resume_url && (
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
                  )}

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
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-5 text-center">
                  <svg className="mx-auto w-8 h-8 text-primary/30" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <p className="mt-2 text-xs text-text/50">
                    {isLoggedIn ? "Resume and portfolio visible to client accounts." : "Create a free account to view resume and portfolio."}
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
                  <p className="text-xs text-text/60">English proficiency locked by StaffVA</p>
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

      {/* ═══════════ BOTTOM CTA ═══════════ */}
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
          ) : isLocked && !isLockingClient ? (
            <div className="text-center">
              <button
                disabled
                className="inline-flex items-center gap-2 rounded-lg bg-gray-200 px-8 py-3 text-sm font-semibold text-gray-500 cursor-not-allowed"
              >
                Not Available — Currently Engaged
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
