"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ApplicationForm from "@/components/apply/ApplicationForm";
import DeviceCheck from "@/components/apply/DeviceCheck";
import TestInstructions from "@/components/apply/TestInstructions";
import EnglishTest from "@/components/apply/EnglishTest";
import TestResult from "@/components/apply/TestResult";
import VoiceRecording1 from "@/components/apply/VoiceRecording1";
import VoiceRecording2 from "@/components/apply/VoiceRecording2";
import ProfileBuilder from "@/components/apply/ProfileBuilder";
import CandidateStatusScreen from "@/components/apply/CandidateStatusScreen";
import IntegrityPledge from "@/components/apply/IntegrityPledge";
import ProctorGate from "@/components/proctor/ProctorGate";
export type ApplicationStep =
  | "loading"
  | "application_form"
  | "device_check"
  | "test_instructions"
  | "integrity_pledge"
  | "english_test"
  | "test_result"
  | "voice_recording_1"
  | "voice_recording_2"
  | "profile_builder"
  | "complete"
  | "anticheat_lockout";

export interface CandidateData {
  id: string;
  // Loaded by the select("*") below; typed so the builder can seed step 4 from
  // it. A returning candidate previously got a blank work-history form, which
  // also orphaned any reference keyed to an entry that no longer existed.
  work_experience?: unknown;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  email: string;
  country: string;
  role_category: string;
  years_experience: string;
  hourly_rate: number;
  time_zone: string;
  linkedin_url: string;
  bio: string;
  us_client_experience: string | null;
  english_mc_score: number | null;
  english_comprehension_score: number | null;
  english_percentile: number | null;
  english_written_tier: string | null;
  admin_status: string;
  id_verification_status: string;
  voice_recording_1_url: string | null;
  voice_recording_2_url: string | null;
  resume_url: string | null;
  payout_method: string | null;
  availability_status: string;
  permanently_blocked: boolean;
  retake_count: number;
  retake_available_at: string | null;
  application_step: string;
  application_stage: number;
  results_display_unlocked: boolean;
  profile_completed_at: string | null;
  profile_photo_url: string | null;
  tagline: string | null;
  interview_consent: boolean;
  id_verification_consent: boolean;
  skills: string[];
  tools: string[];
  test_lockout_until: string | null;
  anticheat_lockout_reason: "four_strikes" | "ten_second_absence" | null;
}

export default function ApplyPage() {
  const router = useRouter();
  const [step, setStep] = useState<ApplicationStep>("loading");
  const [candidateData, setCandidateData] = useState<CandidateData | null>(null);
  const [testPassed, setTestPassed] = useState(false);

  useEffect(() => {
    loadCandidateState();
  }, []);

  // Save the current step to the database
  async function saveStep(newStep: ApplicationStep, candidateId?: string) {
    const id = candidateId || candidateData?.id;
    if (!id || newStep === "loading") return;

    const supabase = createClient();
    await supabase
      .from("candidates")
      .update({ application_step: newStep })
      .eq("id", id);
  }

  // Set step in state AND save to database
  async function goToStep(newStep: ApplicationStep, candidateId?: string) {
    setStep(newStep);
    await saveStep(newStep, candidateId);
  }

  async function loadCandidateState() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return;

    const { data: candidate } = await supabase
      .from("candidates")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (!candidate) {
      setStep("application_form");
      return;
    }

    setCandidateData(candidate);

    // If application stages not complete, show the form at the right stage
    if ((candidate.application_stage || 0) < 3) {
      setStep("application_form");
      return;
    }

    // Permanently blocked → the dashboard's terminal card owns that message.
    // This used to render the RETIRED TestResult screen, which disagrees with
    // /assessment and the dashboard about the same fact — the last reachable
    // door into the superseded English-test machinery.
    if (candidate.permanently_blocked) {
      router.replace("/candidate/dashboard");
      return;
    }

    // If under an anti-cheat lockout, show the lockout screen
    if (candidate.test_lockout_until && new Date(candidate.test_lockout_until) > new Date()) {
      setStep("anticheat_lockout" as ApplicationStep);
      return;
    }

    // Check if ALL completion requirements are met for "complete" status
    // The dashboard sends candidates here for the deferred ID check — this
    // must run BEFORE the fully-complete short-circuit: the exact cohort the
    // ID window serves (assessments done) is also fully complete, and review
    // caught them being bounced to the status screen instead.
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("flow") === "id") {
      // The ID flow lives on its own Atlas page now (step 7). Old links and
      // emails still land here — forward them; /verify-id renders the right
      // state for every status, verified included.
      router.replace("/verify-id");
      return;
    }

    const isFullyComplete =
      candidate.english_mc_score !== null &&
      candidate.english_mc_score >= 70 &&
      (candidate.english_comprehension_score ?? 0) >= 70 &&
      !!candidate.voice_recording_1_url &&
      !!candidate.voice_recording_2_url &&
      !!candidate.profile_photo_url &&
      !!candidate.resume_url &&
      !!candidate.tagline &&
      !!candidate.bio &&
      !!candidate.payout_method &&
      candidate.interview_consent !== false &&
      !!candidate.profile_completed_at;

    if (isFullyComplete) {
      // Failed candidates must go to the dashboard to see their retake date,
      // not the "complete" screen which is meant for approved/pending-review states.
      if (candidate.admin_status === "ai_interview_failed") {
        router.push("/candidate/dashboard");
        return;
      }
      setStep("complete");
      return;
    }

    // --- SESSION RESTORE LOGIC ---
    // Flow: form here, then the Proctored English Assessment on its own
    // Atlas page (/assessment, step 8), then back here for recordings and
    // the profile. ID verification lives on /verify-id (step 7).

    // An approved candidate has no application to continue, and must never be
    // routed onward from here.
    //
    // This is a guard, not tidiness. The reverification reset left
    // english_mc_score NULL for 30 of the 31 live candidates, so a stray
    // "Edit Profile" link into /apply fell through to the NULL branch below
    // and dealt them a real camera-proctored English exam. A failing grade
    // writes back through gradeAttempt, which can set permanently_blocked —
    // the exact column 00186 uses to delist people from the marketplace. A
    // working, listed candidate could remove themselves from it by clicking
    // "Edit Profile", and the notification email is suppressed by the freeze,
    // so it would happen silently.
    if (candidate.admin_status === "approved") {
      router.replace("/candidate/dashboard");
      return;
    }

    // No test score yet → the assessment page owns everything from consent
    // to grading. Failed → the dashboard owns the cooldown card, breakdown
    // and retake date.
    if (candidate.english_mc_score === null) {
      router.replace("/assessment");
      return;
    }

    const testPassed = candidate.english_mc_score >= 70 && (candidate.english_comprehension_score ?? 0) >= 70;
    setTestPassed(testPassed);

    if (!testPassed) {
      router.replace("/candidate/dashboard");
      return;
    }

    // Test passed → check recordings
    if (candidate.voice_recording_1_url && candidate.voice_recording_2_url) {
      setStep("profile_builder");
      return;
    }

    if (candidate.voice_recording_1_url && !candidate.voice_recording_2_url) {
      setStep("voice_recording_2");
      return;
    }

    setStep("voice_recording_1");
  }

  // Flow: form here → the assessment on /assessment (step 8) → back here
  // for recordings and profile. /verify-id (step 7) owns the ID window.
  function handleFormComplete(data: CandidateData) {
    setCandidateData(data);
    // Persist a step slug for the restore logic, then hand off to the
    // assessment page — the whole proctored flow lives there now. Persist
    // WITHOUT setStep: rendering "device_check" even for a frame mounts the
    // retired DeviceCheck→…→EnglishTest chain, and if the navigation is
    // interrupted the candidate sits a full un-proctored legacy exam.
    void saveStep("english_test", data.id);
    router.replace("/assessment");
  }

  function handleDeviceCheckPass() {
    goToStep("test_instructions");
  }

  function handleTestStart() {
    goToStep("integrity_pledge");
  }

  async function handlePledgeAccepted() {
    if (candidateData?.id) {
      const supabase = createClient();
      await supabase.from("candidates").update({
        integrity_pledge_accepted: true,
        integrity_pledge_accepted_at: new Date().toISOString(),
      }).eq("id", candidateData.id);
    }
    goToStep("english_test");
  }

  async function handleTestComplete(passed: boolean, updatedCandidate: CandidateData) {
    setCandidateData(updatedCandidate);
    setTestPassed(passed);
    // Results show immediately — ID verification moved to its own 14-day
    // window after the assessments.
    const supabase = createClient();
    await supabase.from("candidates").update({ results_display_unlocked: true }).eq("id", updatedCandidate.id);
    goToStep(passed ? "voice_recording_1" : "test_result", updatedCandidate.id);
  }

  function handleRecording1Complete(url: string) {
    setCandidateData((prev) =>
      prev ? { ...prev, voice_recording_1_url: url } : prev
    );
    goToStep("voice_recording_2");
  }

  function handleRecording2Complete(url: string) {
    setCandidateData((prev) =>
      prev ? { ...prev, voice_recording_2_url: url } : prev
    );
    // Fire Slack notification async — never blocks candidate flow
    if (candidateData?.id) {
      fetch("/api/notifications/slack-new-candidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate_id: candidateData.id }),
      }).catch(() => { /* silent */ });
    }
    goToStep("profile_builder");
  }

  async function handleProfileComplete() {
    // Re-fetch candidate data to check all completion requirements
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: latest } = await supabase
      .from("candidates")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (!latest) return;

    // The "set to active" transition now happens in mark_profile_complete
    // (migration 00120), not here. The browser can no longer write admin_status
    // at all: the column-level UPDATE grant was revoked, because with it any
    // signed-in candidate could set their own row to 'approved' from devtools.
    // The RPC re-checks completeness server-side and refuses to touch protected
    // statuses, so the allComplete guard that used to live here moved with it.
    const { error: completeError } = await supabase.rpc("mark_profile_complete");
    if (completeError) {
      // Not fatal for the candidate's flow — the hourly promote-ready sweep
      // asks the same question again — but say so rather than swallowing it.
      console.error("mark_profile_complete failed:", completeError.message);
    }

    // Finishing the profile is the second of the two ways a candidate becomes
    // approvable; the AI interview may already be passed and waiting on exactly
    // this. Asked unconditionally rather than behind `allComplete` above,
    // because that check is a partial copy of the real gate list — it omits ID
    // verification — and the point of promote_candidate_if_ready (migration
    // 00116) is that one definition decides. It returns the unchanged status
    // when a gate is still open, so calling it is always safe.
    const { error: promoteError } = await supabase.rpc("promote_candidate_if_ready", {
      p_candidate_id: latest.id,
    });

    if (promoteError) {
      // Not worth blocking the candidate's flow over: they have finished their
      // part, and the hourly promote-ready sweep will pick them up.
      console.error("Could not decide placement after profile completion:", promoteError.message);
    }

    setCandidateData({ ...candidateData!, ...latest, profile_completed_at: new Date().toISOString() } as CandidateData);
    goToStep("complete");
  }

  if (step === "loading") {
    return (
      <main className="flex min-h-[calc(100vh-73px)] items-center justify-center bg-background">
        <p className="text-text/60">Loading your application...</p>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-73px)] bg-background">
      {/* Progress bar */}
      {step !== "complete" && step !== "test_result" && step !== "anticheat_lockout" && (
        <div className="mx-auto max-w-3xl px-6 pt-6">
          <div className="flex items-center gap-1">
            {["application_form", "english_test", "voice_recording_1", "profile_builder"].map((s, i) => {
              const stepOrder = ["application_form", "device_check", "test_instructions", "integrity_pledge", "english_test", "test_result", "voice_recording_1", "voice_recording_2", "profile_builder"];
              const currentIndex = stepOrder.indexOf(step);
              const thisIndex = stepOrder.indexOf(s);
              const isComplete = currentIndex > thisIndex;
              const isCurrent = step === s
                || (s === "english_test" && ["device_check", "test_instructions", "integrity_pledge", "english_test"].includes(step));
              return (
                <div key={s} className="flex-1">
                  <div className={`h-1.5 rounded-full ${isComplete ? "bg-primary" : isCurrent ? "bg-primary/50" : "bg-gray-200"}`} />
                  <p className="mt-1 text-[10px] text-text/40 text-center">
                    {["Application", "English Test", "Recordings", "Profile"][i]}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {step === "application_form" && (
        <ApplicationForm
          onComplete={handleFormComplete}
          initialStage={candidateData?.application_stage || 0}
          existingCandidate={candidateData}
        />
      )}
      {step === "device_check" && (
        <DeviceCheck onPass={handleDeviceCheckPass} candidateId={candidateData?.id} />
      )}
      {step === "test_instructions" && (
        <TestInstructions onStart={handleTestStart} />
      )}
      {step === "integrity_pledge" && (
        <IntegrityPledge onAccept={handlePledgeAccepted} />
      )}
      {step === "english_test" && candidateData && (
        // FocusEnforcement is gone. It was a second, cruder anti-cheat mounted
        // over the one inside EnglishTest: it fired its full-screen "You left
        // the test screen" overlay on every mouseleave — reaching for the
        // scrollbar included — and logged tab switches and cursor drift as the
        // same event. Measured against production, its flags had no
        // relationship to score. EnglishTest's own instrumentation (typed
        // events through /api/proctor/events, warning at three real flags) is
        // the surviving system.
        <ProctorGate sessionKind="english_test">
          <EnglishTest
            candidateId={candidateData.id}
            onComplete={handleTestComplete}
          />
        </ProctorGate>
      )}
      {step === "test_result" && candidateData && (
        <TestResult candidate={candidateData} passed={testPassed} />
      )}
      {step === "voice_recording_1" && candidateData && (
        <VoiceRecording1
          candidateId={candidateData.id}
          onComplete={handleRecording1Complete}
        />
      )}
      {step === "voice_recording_2" && candidateData && (
        <VoiceRecording2
          candidateId={candidateData.id}
          onComplete={handleRecording2Complete}
        />
      )}
      {step === "profile_builder" && candidateData && (
        <ProfileBuilder
          candidateId={candidateData.id}
          candidateData={{
            full_name: candidateData.full_name,
            display_name: candidateData.display_name ?? undefined,
            role_category: candidateData.role_category,
            hourly_rate: candidateData.hourly_rate,
            bio: candidateData.bio ?? undefined,
            tagline: candidateData.tagline ?? undefined,
            english_written_tier: candidateData.english_written_tier ?? undefined,
            skills: candidateData.skills || [],
            tools: candidateData.tools || [],
            work_experience: (candidateData.work_experience as never) ?? null,
            // Read by the review step's checklist and used to seed the new
            // Atlas fields, so a returning candidate keeps what they typed.
            profile_photo_url: candidateData.profile_photo_url ?? null,
            profile_completed_at: candidateData.profile_completed_at ?? null,
            country: candidateData.country ?? null,
            city: (candidateData as { city?: string | null }).city ?? null,
            role_title: (candidateData as { role_title?: string | null }).role_title ?? null,
            resume_url: candidateData.resume_url ?? null,
            video_intro_url: (candidateData as { video_intro_url?: string | null }).video_intro_url ?? null,
            voice_recording_2_url: candidateData.voice_recording_2_url ?? null,
            hours_per_week: (candidateData as { hours_per_week?: number | null }).hours_per_week ?? null,
            working_hours: (candidateData as { working_hours?: string | null }).working_hours ?? null,
            education: (candidateData as { education?: unknown }).education ?? null,
            certifications: (candidateData as { certifications?: unknown }).certifications ?? null,
          }}
          onComplete={handleProfileComplete}
        />
      )}
      {step === "complete" && candidateData && (
        <CandidateStatusScreen adminStatus={candidateData.admin_status} candidateId={candidateData.id} />
      )}
      {step === "anticheat_lockout" && candidateData?.test_lockout_until && (
        <AnticheatlockoutScreen
          lockoutUntil={candidateData.test_lockout_until}
        />
      )}
    </main>
  );
}

function AnticheatlockoutScreen({ lockoutUntil }: { lockoutUntil: string }) {
  const unlockDate = new Date(lockoutUntil);
  const now = new Date();
  const msRemaining = unlockDate.getTime() - now.getTime();
  const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));

  const formattedDate = unlockDate.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="flex min-h-[calc(100vh-73px)] items-center justify-center bg-background px-6">
      <div className="mx-auto max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
          <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-text">Your assessment is currently paused</h1>
        <p className="mt-4 text-sm leading-relaxed text-text/60">
          You left the test screen during your English assessment, which is not permitted.
        </p>
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-6 py-5">
          <p className="text-sm text-text/70">
            You may return on <strong className="text-text">{formattedDate}</strong>.
            When you return your assessment will restart from the beginning.
          </p>
          <p className="mt-3 text-2xl font-bold text-red-600">
            {daysRemaining} {daysRemaining === 1 ? "day" : "days"} remaining
          </p>
        </div>
      </div>
    </div>
  );
}
