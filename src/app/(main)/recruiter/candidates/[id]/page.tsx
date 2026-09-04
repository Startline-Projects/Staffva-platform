"use server";

import { createClient } from "@supabase/supabase-js";
import { getUser } from "@/lib/auth";
import { assertRecruiterScope } from "@/lib/recruiterScope";
import Link from "next/link";
import { redirect } from "next/navigation";
import { marketAvailability } from "@/lib/candidateVisibility";

/**
 * Display names for the Interview 2 role task.
 *
 * The router itself lives in the interview app (src/lib/roleTask.ts) and stays
 * there — it is the thing that decides which exam somebody sits, and two copies
 * of a decision like that drift. These are labels only: if a fourth task key
 * ever appears, this map falls back rather than crashing a recruiter's page.
 */
type TaskKey = "triage" | "reconcile" | "review";
const TASK_LABELS: Record<TaskKey, string> = {
  triage: "Client request handling",
  reconcile: "Records accuracy check",
  review: "Document review",
};

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
  if (!user || user.app_metadata?.role !== "recruiter") {
    redirect("/login");
  }

  // Scope check — a recruiter may only open candidates in their assigned
  // categories. Without this, any recruiter could read any candidate's full
  // record (select *) just by changing the id in the URL.
  const scopeError = await assertRecruiterScope(user.id, id);
  if (scopeError) {
    redirect("/recruiter");
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
    .eq("kind", "skills")
    .eq("candidate_id", id)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // The role task from their most recent skills interview.
  //
  // Deliberately NOT filtered on status='completed' or passed=true, unlike the
  // scorecard read above. The task is measured, not judged: it is exactly as
  // informative on an interview somebody abandoned, and 30 of the 31 approved
  // candidates have no completed+passed row at all after the 00143
  // re-verification reset, so a filtered read would show this to almost nobody.
  const { data: taskInterview } = await supabase
    .from("ai_interviews")
    .select("id, task_key, task_status, task_score_pct, task_mapping_confident, task_role_category")
    .eq("kind", "skills")
    .eq("candidate_id", id)
    .not("task_status", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: taskResult } = taskInterview?.id
    ? await supabase
        .from("interview_task_results")
        .select("detail, elapsed_ms, score_pct")
        .eq("interview_id", taskInterview.id)
        .maybeSingle()
    : { data: null };

  const taskVerdicts =
    ((taskResult?.detail as { verdicts?: { id: string; correct: boolean; why: string; got: string; expected: string }[] } | null)
      ?.verdicts) || [];

  // Availability from the candidate's own answer. This read committed_hours —
  // 0 on every row, written by nothing — so every candidate showed "Available"
  // to recruiters, and the "hrs/week remaining" figure was 50 minus zero. The
  // public profile page made the same mistake with a different constant (40),
  // so the two screens quoted different fabricated capacities for one person.
  const availKind = marketAvailability(candidate).kind;
  const availabilityComputed =
    availKind === "now" ? "available" : availKind === "by_date" ? "partial" : "unavailable";
  const availableFrom =
    availKind === "by_date" && candidate.availability_date
      ? new Date(candidate.availability_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : null;

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
              <p className="text-xs text-white/40 mt-1">per hour</p>
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
                    ? (availableFrom ? `Available from ${availableFrom}` : "Available soon")
                    : "Not available"}
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

        {/* Skills task — measured, not judged. Shown whenever a task ran, in
            whatever state, because "they missed three of the four planted
            errors" is exactly as useful on an abandoned interview. */}
        {taskInterview?.task_status && (
          <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6">
            <div className="flex items-baseline justify-between gap-4 flex-wrap mb-4">
              <h2 className="text-lg font-bold text-text">Skills task</h2>
              <span className="text-xs font-semibold text-text/50 uppercase tracking-wide">
                {TASK_LABELS[taskInterview.task_key as TaskKey] ?? "Role task"}
                {taskInterview.task_role_category ? ` · ${taskInterview.task_role_category}` : ""}
              </span>
            </div>

            {taskInterview.task_status === "scored" && taskInterview.task_score_pct !== null ? (
              <>
                <div className="flex items-end gap-8 mb-5">
                  <div>
                    <p className="text-xs font-semibold text-text/60 uppercase tracking-wide mb-1">Score</p>
                    <p className="text-4xl font-bold text-primary">
                      {Math.round(Number(taskInterview.task_score_pct))}%
                    </p>
                  </div>
                  {taskResult?.elapsed_ms ? (
                    <div>
                      <p className="text-xs font-semibold text-text/60 uppercase tracking-wide mb-1">Time taken</p>
                      <p className="text-lg font-semibold text-text">
                        {Math.round(taskResult.elapsed_ms / 60000)} min
                      </p>
                    </div>
                  ) : null}
                </div>
                {taskInterview.task_mapping_confident === false && (
                  <p className="mb-4 text-sm text-text/60">
                    We could not confidently match this candidate&apos;s role, so they were given
                    the general assistant task. Weigh this result accordingly.
                  </p>
                )}
                {taskVerdicts.length > 0 && (
                  <div className="space-y-2">
                    {taskVerdicts.map((v) => (
                      <div
                        key={v.id}
                        className={`rounded-lg border p-3 text-sm ${
                          v.correct ? "border-gray-200 bg-gray-50" : "border-amber-200 bg-amber-50"
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-text/50 shrink-0">
                            {v.correct ? "OK" : "Missed"}
                          </span>
                          <div>
                            <p className="text-text">{v.why}</p>
                            {!v.correct && (
                              <p className="mt-1 text-text/60">
                                They put <span className="font-medium">{v.got}</span>; expected{" "}
                                <span className="font-medium">{v.expected}</span>.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-text/60">
                {taskInterview.task_status === "abandoned"
                  ? "The candidate started this task and could not finish it. That is not a score, and it may well be ours — a stalled connection looks exactly like this."
                  : "A task was served but no result was scored. Do not read anything into that."}
              </p>
            )}
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
