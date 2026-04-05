"use client";

import { useState, useEffect } from "react";
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
import IDVerificationConsent from "@/components/apply/IDVerificationConsent";
import IDVerification from "@/components/apply/IDVerification";
import IntegrityPledge from "@/components/apply/IntegrityPledge";
import PostTestVerification from "@/components/apply/PostTestVerification";
import FocusEnforcement from "@/components/apply/FocusEnforcement";

export type ApplicationStep =
  | "loading"
  | "application_form"
  | "id_consent"
  | "id_verification"
  | "device_check"
  | "test_instructions"
  | "integrity_pledge"
  | "english_test"
  | "post_test_verification"
  | "test_result"
  | "voice_recording_1"
  | "voice_recording_2"
  | "profile_builder"
  | "complete";

export interface CandidateData {
  id: string;
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
  us_client_experience: string;
  us_client_description: string;
  english_mc_score: number | null;
  english_comprehension_score: number | null;
  english_percentile: number | null;
  english_written_tier: string | null;
  speaking_level: string | null;
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
}

export default function ApplyPage() {
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

    // If permanently blocked from retakes, show result
    if (candidate.permanently_blocked) {
      setStep("test_result");
      return;
    }

    // Check if ALL completion requirements are met for "complete" status
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
      setStep("complete");
      return;
    }

    // --- SESSION RESTORE LOGIC ---
    // New flow: form → device_check → test → post_test_verification → id_consent → id_verification → results → recordings → profile

    // Step 1: Check if test was taken
    if (candidate.english_mc_score === null) {
      // No test score — go to device check (pre-test flow)
      setStep("device_check");
      return;
    }

    // Test taken — check if ID verification is done
    const testPassed = candidate.english_mc_score >= 70 && (candidate.english_comprehension_score ?? 0) >= 70;
    setTestPassed(testPassed);

    if (!candidate.id_verification_consent) {
      // Test done but no ID consent yet — show post-test verification transition
      setStep("post_test_verification");
      return;
    }

    if (candidate.id_verification_status !== "passed") {
      if (candidate.id_verification_status === "manual_review") {
        // Pending manual review — don't show results
        setStep("id_verification");
      } else {
        // Not passed yet (pending or failed) — show ID verification
        setStep("id_verification");
      }
      return;
    }

    // ID verified — results unlocked
    if (!testPassed) {
      setStep("test_result");
      return;
    }

    // Test passed + ID verified → check recordings
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

  // New flow: form → device_check → test → post_test_verification → id_consent → id_verification → results
  function handleFormComplete(data: CandidateData) {
    setCandidateData(data);
    goToStep("device_check", data.id);
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

  function handleTestComplete(passed: boolean, updatedCandidate: CandidateData) {
    setCandidateData(updatedCandidate);
    setTestPassed(passed);
    // Don't show results yet — route to ID verification
    goToStep("post_test_verification", updatedCandidate.id);
  }

  function handlePostTestVerify() {
    goToStep("id_consent");
  }

  function handleIDConsentComplete() {
    if (candidateData) {
      setCandidateData({ ...candidateData, id_verification_consent: true });
    }
    goToStep("id_verification", candidateData?.id);
  }

  async function handleIDVerificationComplete() {
    if (candidateData) {
      setCandidateData({ ...candidateData, id_verification_status: "passed", results_display_unlocked: true });
      // Unlock results display
      const supabase = createClient();
      await supabase.from("candidates").update({ results_display_unlocked: true }).eq("id", candidateData.id);
    }
    // Now show results
    if (testPassed) {
      goToStep("voice_recording_1", candidateData?.id);
    } else {
      goToStep("test_result", candidateData?.id);
    }
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

    const allComplete =
      latest.english_mc_score !== null &&
      latest.english_mc_score >= 70 &&
      (latest.english_comprehension_score ?? 0) >= 70 &&
      !!latest.voice_recording_1_url &&
      !!latest.voice_recording_2_url &&
      !!latest.profile_photo_url &&
      !!latest.resume_url &&
      !!latest.tagline &&
      !!latest.bio &&
      !!latest.payout_method &&
      latest.interview_consent !== false;

    if (allComplete && latest.admin_status !== "approved") {
      // Auto-approve profile — candidate can start AI interview immediately
      await supabase
        .from("candidates")
        .update({
          admin_status: "approved",
          profile_completed_at: new Date().toISOString(),
        })
        .eq("id", latest.id);
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
      {step !== "complete" && step !== "test_result" && (
        <div className="mx-auto max-w-3xl px-6 pt-6">
          <div className="flex items-center gap-1">
            {["application_form", "english_test", "id_verification", "voice_recording_1", "profile_builder"].map((s, i) => {
              const stepOrder = ["application_form", "device_check", "test_instructions", "integrity_pledge", "english_test", "post_test_verification", "id_consent", "id_verification", "test_result", "voice_recording_1", "voice_recording_2", "profile_builder"];
              const currentIndex = stepOrder.indexOf(step);
              const thisIndex = stepOrder.indexOf(s);
              const isComplete = currentIndex > thisIndex;
              const isCurrent = step === s
                || (s === "english_test" && ["device_check", "test_instructions", "integrity_pledge", "english_test"].includes(step))
                || (s === "id_verification" && ["post_test_verification", "id_consent", "id_verification"].includes(step));
              return (
                <div key={s} className="flex-1">
                  <div className={`h-1.5 rounded-full ${isComplete ? "bg-primary" : isCurrent ? "bg-primary/50" : "bg-gray-200"}`} />
                  <p className="mt-1 text-[10px] text-text/40 text-center">
                    {["Application", "English Test", "Identity", "Recordings", "Profile"][i]}
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
        <DeviceCheck onPass={handleDeviceCheckPass} />
      )}
      {step === "test_instructions" && (
        <TestInstructions onStart={handleTestStart} />
      )}
      {step === "integrity_pledge" && (
        <IntegrityPledge onAccept={handlePledgeAccepted} />
      )}
      {step === "english_test" && candidateData && (
        <FocusEnforcement candidateId={candidateData.id} testSection="english_test">
          <EnglishTest
            candidateId={candidateData.id}
            onComplete={handleTestComplete}
          />
        </FocusEnforcement>
      )}
      {step === "post_test_verification" && (
        <PostTestVerification onVerify={handlePostTestVerify} />
      )}
      {step === "id_consent" && candidateData && (
        <IDVerificationConsent
          candidateId={candidateData.id}
          onConsented={handleIDConsentComplete}
        />
      )}
      {step === "id_verification" && candidateData && (
        <IDVerification
          candidateId={candidateData.id}
          verificationStatus={candidateData.id_verification_status || "pending"}
          onComplete={handleIDVerificationComplete}
        />
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
            english_written_tier: candidateData.english_written_tier ?? undefined,
            speaking_level: candidateData.speaking_level ?? undefined,
            skills: candidateData.skills || [],
            tools: candidateData.tools || [],
          }}
          onComplete={handleProfileComplete}
        />
      )}
      {step === "complete" && candidateData && (
        <CandidateStatusScreen adminStatus={candidateData.admin_status} candidateId={candidateData.id} />
      )}
    </main>
  );
}
