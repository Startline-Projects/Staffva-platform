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
  exceptional: { label: "Exceptional", color: "text-emerald-700", bg: "bg-emerald-100" },
  proficient: { label: "Proficient", color: "text-blue-700", bg: "bg-blue-100" },
  competent: { label: "Competent", color: "text-gray-700", bg: "bg-gray-100" },
};

const SPEAKING_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  fluent: { label: "Fluent", color: "text-emerald-700", bg: "bg-emerald-100" },
  proficient: { label: "Proficient", color: "text-blue-700", bg: "bg-blue-100" },
  conversational: { label: "Conversational", color: "text-amber-700", bg: "bg-amber-100" },
  basic: { label: "Basic", color: "text-gray-700", bg: "bg-gray-100" },
};

const US_EXPERIENCE_LABELS: Record<string, string> = {
  full_time: "Full-time US client experience",
  part_time_contract: "Part-time / contract US client experience",
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

  const { data: candidate } = await supabase
    .from("candidates")
    .select("*")
    .eq("id", id)
    .eq("admin_status", "approved")
    .single();

  if (!candidate) {
    return (
      <div className="flex min-h-[calc(100vh-73px)] items-center justify-center bg-background">
        <div className="text-center">
          <svg className="mx-auto w-16 h-16 text-text/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <h1 className="mt-4 text-2xl font-bold text-text">Profile Not Found</h1>
          <p className="mt-2 text-sm text-text/60">This candidate may no longer be available.</p>
          <Link href="/browse" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors">
            &larr; Browse Talent
          </Link>
        </div>
      </div>
    );
  }

  const user = await getUser();
  const isLoggedIn = !!user;
  const isClient = user?.user_metadata?.role === "client";
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
  const canViewGatedAssets = isLoggedIn && isClient;

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
      {/* Top bar */}
      <div className="border-b border-gray-200 bg-card">
        <div className="mx-auto max-w-5xl px-6 py-4">
          <Link href="/browse" className="inline-flex items-center gap-1.5 text-sm text-text/60 hover:text-primary transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Browse
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* LEFT COLUMN — Main profile info */}
          <div className="lg:col-span-2 space-y-6">

            {/* Profile header card */}
            <div className="rounded-xl border border-gray-200 bg-card p-8">
              {/* Lock banner */}
              {isLocked && !isLockingClient && (
                <div className="mb-6 flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-3 text-sm text-gray-600">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Currently engaged with another client
                </div>
              )}

              <div className="flex items-start justify-between">
                <div>
                  {/* Avatar circle */}
                  <div className="flex items-center gap-4">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                      <span className="text-2xl font-bold text-primary">
                        {candidate.display_name?.charAt(0) || "?"}
                      </span>
                    </div>
                    <div>
                      <h1 className="text-2xl font-bold text-text">{displayedName}</h1>
                      {isLockingClient && (
                        <p className="text-xs text-primary font-medium">Full name visible to you only</p>
                      )}
                      <p className="mt-0.5 text-text/60">
                        {candidate.country} &middot; {candidate.time_zone}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-bold text-primary">
                    ${candidate.monthly_rate.toLocaleString()}
                  </p>
                  <p className="text-xs text-text/40 mt-0.5">per month</p>
                </div>
              </div>

              {/* Badges row */}
              <div className="mt-6 flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                  {candidate.role_category}
                </span>
                {tier && (
                  <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${tier.bg} ${tier.color}`}>
                    <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    English: {tier.label}
                  </span>
                )}
                {speaking && (
                  <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${speaking.bg} ${speaking.color}`}>
                    <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                    </svg>
                    Speaking: {speaking.label}
                  </span>
                )}
                {hasUSExperience && (
                  <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
                    <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 8l2.55 3.4A1 1 0 0116 13H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z" clipRule="evenodd" />
                    </svg>
                    US Experience
                  </span>
                )}
                {!isLocked && (
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                    candidate.availability_status === "available_now"
                      ? "bg-green-100 text-green-700"
                      : candidate.availability_status === "available_by_date"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-gray-100 text-gray-600"
                  }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${
                      candidate.availability_status === "available_now" ? "bg-green-500" : "bg-amber-500"
                    }`} />
                    {candidate.availability_status === "available_now"
                      ? "Available Now"
                      : candidate.availability_status === "available_by_date"
                      ? `Available ${new Date(candidate.availability_date).toLocaleDateString()}`
                      : "Not Available"}
                  </span>
                )}
              </div>

              {/* Stats row */}
              <div className="mt-5 flex flex-wrap items-center gap-4 text-sm">
                {Number(candidate.total_earnings_usd) > 0 && (
                  <span className="flex items-center gap-1 text-green-600 font-medium">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    ${Number(candidate.total_earnings_usd).toLocaleString()} verified earnings
                  </span>
                )}
                {avgRating && (
                  <span className="flex items-center gap-1 text-amber-600 font-medium">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    {avgRating} ({reviews!.length} {reviews!.length === 1 ? "review" : "reviews"})
                  </span>
                )}
                {(tenureBadges || []).map((badge) => (
                  <span key={badge.badge_type} className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-700">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    {badge.badge_type.replace(/_/g, " ")} tenure
                  </span>
                ))}
              </div>
            </div>

            {/* About section */}
            {candidate.bio && (
              <div className="rounded-xl border border-gray-200 bg-card p-6">
                <h2 className="text-sm font-semibold text-text/40 uppercase tracking-wider">About</h2>
                <p className="mt-3 text-sm leading-relaxed text-text/80">{candidate.bio}</p>
              </div>
            )}

            {/* Experience details */}
            <div className="rounded-xl border border-gray-200 bg-card p-6">
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
                {candidate.linkedin_url && (
                  <div>
                    <p className="text-xs text-text/40">LinkedIn</p>
                    <a href={candidate.linkedin_url} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-dark">
                      View Profile
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* Voice recordings + resume + portfolio */}
            {canViewGatedAssets ? (
              <>
                {(candidate.voice_recording_1_url || candidate.voice_recording_2_url) && (
                  <div className="rounded-xl border border-gray-200 bg-card p-6">
                    <h2 className="text-sm font-semibold text-text/40 uppercase tracking-wider">Voice Recordings</h2>
                    <div className="mt-4 space-y-4">
                      {candidate.voice_recording_1_url && (
                        <div>
                          <p className="mb-2 text-xs font-medium text-text/60">Oral Reading Passage</p>
                          <audio controls src={candidate.voice_recording_1_url} className="w-full h-10" />
                        </div>
                      )}
                      {candidate.voice_recording_2_url && (
                        <div>
                          <p className="mb-2 text-xs font-medium text-text/60">Self Introduction (60 sec)</p>
                          <audio controls src={candidate.voice_recording_2_url} className="w-full h-10" />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {candidate.resume_url && (
                  <div className="rounded-xl border border-gray-200 bg-card p-6">
                    <h2 className="text-sm font-semibold text-text/40 uppercase tracking-wider">Resume</h2>
                    <a
                      href={candidate.resume_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-text hover:bg-gray-50 transition-colors"
                    >
                      <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                      </svg>
                      Download Resume (PDF)
                    </a>
                  </div>
                )}

                {(portfolioItems || []).length > 0 && (
                  <div className="rounded-xl border border-gray-200 bg-card p-6">
                    <h2 className="text-sm font-semibold text-text/40 uppercase tracking-wider">Portfolio</h2>
                    <div className="mt-4 space-y-2">
                      {(portfolioItems || []).map((item) => (
                        <a
                          key={item.id}
                          href={item.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 hover:bg-gray-50 hover:border-primary/20 transition-all"
                        >
                          <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/10">
                            <span className="text-xs font-bold uppercase text-primary">{item.file_type}</span>
                          </div>
                          <span className="text-sm text-text">{item.description || "Portfolio item"}</span>
                          <svg className="ml-auto w-4 h-4 text-text/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-8 text-center">
                <svg className="mx-auto w-10 h-10 text-primary/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <p className="mt-3 text-sm font-medium text-text">
                  {isLoggedIn
                    ? "Voice recordings, resume, and portfolio are visible to client accounts."
                    : "Create a free account to hear voice recordings, view resume, and portfolio."}
                </p>
                {!isLoggedIn && (
                  <Link
                    href="/signup/client"
                    className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors"
                  >
                    Create Free Account
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </Link>
                )}
              </div>
            )}

            {/* Reviews */}
            {(reviews || []).length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-card p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-text/40 uppercase tracking-wider">
                    Client Reviews
                  </h2>
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

          {/* RIGHT COLUMN — Sticky sidebar */}
          <div className="lg:col-span-1">
            <div className="sticky top-24 space-y-4">
              {/* CTA card */}
              <div className="rounded-xl border border-gray-200 bg-card p-6">
                <p className="text-center text-2xl font-bold text-primary">
                  ${candidate.monthly_rate.toLocaleString()}
                  <span className="text-sm font-normal text-text/40">/mo</span>
                </p>
                <p className="mt-1 text-center text-xs text-text/40">
                  + 10% platform fee
                </p>
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

              {/* Quick info card */}
              <div className="rounded-xl border border-gray-200 bg-card p-6 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text/40">Role</span>
                  <span className="text-sm font-medium text-text">{candidate.role_category}</span>
                </div>
                <div className="border-t border-gray-100" />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text/40">Experience</span>
                  <span className="text-sm font-medium text-text">{candidate.years_experience}</span>
                </div>
                <div className="border-t border-gray-100" />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text/40">Country</span>
                  <span className="text-sm font-medium text-text">{candidate.country}</span>
                </div>
                <div className="border-t border-gray-100" />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text/40">Time Zone</span>
                  <span className="text-sm font-medium text-text">{candidate.time_zone}</span>
                </div>
                {tier && (
                  <>
                    <div className="border-t border-gray-100" />
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text/40">Written English</span>
                      <span className={`text-sm font-medium ${tier.color}`}>{tier.label}</span>
                    </div>
                  </>
                )}
                {speaking && (
                  <>
                    <div className="border-t border-gray-100" />
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text/40">Speaking</span>
                      <span className={`text-sm font-medium ${speaking.color}`}>{speaking.label}</span>
                    </div>
                  </>
                )}
              </div>

              {/* Trust signals */}
              <div className="rounded-xl bg-gray-50 p-5 space-y-3">
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <p className="text-xs text-text/60">Identity verified via government ID</p>
                </div>
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
                  <p className="text-xs text-text/60">Payments protected by escrow</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
