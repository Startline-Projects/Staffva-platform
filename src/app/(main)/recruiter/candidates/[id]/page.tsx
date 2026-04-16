"use server";

import { createClient } from "@supabase/supabase-js";
import { getUser } from "@/lib/auth";
import Link from "next/link";
import { redirect } from "next/navigation";

async function AudioPlayerServer({ bucket, path, label }: { bucket: string; path: string; label: string }) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let audioUrl = path;

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

async function EquipmentDetails({ candidate }: { candidate: any }) {
  const hasEquipmentInfo = candidate.computer_specs || candidate.has_headset || candidate.has_webcam || candidate.speed_test_screenshot;

  if (!hasEquipmentInfo) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <h3 className="text-lg font-bold text-text mb-4">Equipment Details</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {candidate.computer_specs && (
          <div>
            <p className="text-xs font-semibold text-text/60 uppercase mb-1">Computer Specs</p>
            <p className="text-sm text-text">{candidate.computer_specs}</p>
          </div>
        )}
        <div>
          <p className="text-xs font-semibold text-text/60 uppercase mb-1">Headset</p>
          <p className="text-sm text-text">{candidate.has_headset ? "Yes" : "No"}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-text/60 uppercase mb-1">Webcam</p>
          <p className="text-sm text-text">{candidate.has_webcam ? "Yes" : "No"}</p>
        </div>
        {candidate.speed_test_screenshot && (
          <div>
            <p className="text-xs font-semibold text-text/60 uppercase mb-1">Speed Test</p>
            <a
              href={candidate.speed_test_screenshot}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <img
                src={candidate.speed_test_screenshot}
                alt="Speed test screenshot"
                className="h-12 w-12 rounded border border-gray-200 object-cover"
              />
              View
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

const TIER_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  exceptional: { label: "Exceptional", color: "text-white", bg: "bg-emerald-600" },
  advanced: { label: "Advanced", color: "text-white", bg: "bg-blue-600" },
  professional: { label: "Professional", color: "text-white", bg: "bg-gray-500" },
};

export default async function RecruiterCandidateProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getUser();

  // Auth check — recruiter role required
  if (!user || user.user_metadata?.role !== "recruiter") {
    redirect("/login");
  }

  // Service-role client for data fetching (required per RLS rules)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Fetch candidate
  const { data: candidate } = await supabase
    .from("candidates")
    .select("*")
    .eq("id", id)
    .single();

  if (!candidate) {
    return (
      <div className="flex min-h-[calc(100vh-73px)] items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-text">Candidate Not Found</h1>
          <p className="mt-2 text-sm text-text/60">This candidate record could not be found.</p>
          <Link href="/recruiter" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 transition-colors">
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  // Fetch AI interview data
  const { data: aiInterview } = await supabase
    .from("ai_interviews")
    .select("overall_score, badge_level, technical_knowledge_score, problem_solving_score, communication_score, experience_depth_score, professionalism_score")
    .eq("candidate_id", id)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Compute availability
  const committedHours = candidate.committed_hours || 0;
  const availabilityComputed = committedHours === 0
    ? "available"
    : committedHours < 40
    ? "partial"
    : "unavailable";
  const remainingHours = 50 - committedHours;

  const tier = candidate.english_written_tier ? TIER_CONFIG[candidate.english_written_tier] : null;
  const displayedName = candidate.display_name || candidate.full_name;
  const tools: string[] = candidate.tools || [];
  const skills: string[] = candidate.skills || [];

  return (
    <div className="min-h-screen bg-background">
      {/* HEADER */}
      <div className="bg-[#1C1B1A]">
        <div className="mx-auto max-w-5xl px-6 py-4">
          <Link href="/recruiter" className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Dashboard
          </Link>
        </div>

        <div className="mx-auto max-w-5xl px-6 pb-10">
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
                      {displayedName?.charAt(0) || "?"}
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
                </div>
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

      {/* MAIN CONTENT */}
      <div className="mx-auto max-w-5xl px-6 py-8">
        {/* Bio */}
        {candidate.bio && (
          <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="text-lg font-bold text-text mb-3">Bio</h2>
            <p className="text-sm text-text/80 leading-relaxed whitespace-pre-wrap">{candidate.bio}</p>
          </div>
        )}

        {/* Audio Players */}
        <div className="mb-8">
          <h2 className="text-lg font-bold text-text mb-4">Voice Recordings</h2>
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
        </div>

        {/* Skills */}
        {skills.length > 0 && (
          <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="text-lg font-bold text-text mb-4">Skills</h2>
            <div className="flex flex-wrap gap-2">
              {skills.map((skill) => (
                <span key={skill} className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-text">
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Tools */}
        {tools.length > 0 && (
          <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="text-lg font-bold text-text mb-4">Tools</h2>
            <div className="flex flex-wrap gap-2">
              {tools.map((tool) => (
                <span key={tool} className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
                  {tool}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* AI Interview Score */}
        {aiInterview && aiInterview.overall_score && (
          <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="text-lg font-bold text-text mb-4">AI Interview Score</h2>
            <div className="flex items-end gap-8">
              <div>
                <p className="text-xs font-semibold text-text/60 uppercase tracking-wide mb-1">Overall Score</p>
                <p className="text-4xl font-bold text-primary">{Math.round(aiInterview.overall_score)}/100</p>
                {aiInterview.badge_level && (
                  <p className="mt-2 text-xs font-semibold text-text/60 uppercase">{aiInterview.badge_level}</p>
                )}
              </div>
              <div className="flex-1">
                <div className="space-y-3">
                  {[
                    { label: "Technical Knowledge", score: aiInterview.technical_knowledge_score },
                    { label: "Problem Solving", score: aiInterview.problem_solving_score },
                    { label: "Communication", score: aiInterview.communication_score },
                    { label: "Experience Depth", score: aiInterview.experience_depth_score },
                    { label: "Professionalism", score: aiInterview.professionalism_score },
                  ].map(({ label, score }) => (
                    <div key={label}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-text/70">{label}</span>
                        <span className="text-xs font-semibold text-text">{Math.round((score || 0) * 5)}/100</span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-200">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.min(Math.round((score || 0) * 5), 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Equipment Details */}
        <EquipmentDetails candidate={candidate} />
      </div>
    </div>
  );
}
