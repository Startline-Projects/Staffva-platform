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

export type ApplicationStep =
  | "loading"
  | "application_form"
  | "id_consent"
  | "id_verification"
  | "device_check"
  | "test_instructions"
  | "english_test"
  | "test_result"
  | "voice_recording_1"
  | "voice_recording_2"
  | "profile_builder"
  | "complete";

export interface CandidateData {
  id: string;
  full_name: string;
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
    // New flow: form → id_consent → id_verification → device_check → test → recordings → profile

    // Step 1: Check ID verification consent + status
    if (!candidate.id_verification_consent) {
      setStep("id_consent");
      return;
    }

    if (candidate.id_verification_status !== "passed") {
      // Verification not complete — show ID verification screen
      setStep("id_verification");
      return;
    }

    // Step 2: Check if test was taken
    if (candidate.english_mc_score !== null) {
      const passed =
        candidate.english_mc_score >= 70 &&
        (candidate.english_comprehension_score ?? 0) >= 70;
      setTestPassed(passed);

      if (!passed) {
        setStep("test_result");
        return;
      }
    } else {
      // No test score — go to device check (pre-test flow)
      const savedStep = candidate.application_step as ApplicationStep;
      const midTestSteps: ApplicationStep[] = ["device_check", "test_instructions", "english_test"];

      if (midTestSteps.includes(savedStep)) {
        setStep("device_check");
      } else {
        setStep("device_check");
      }
      return;
    }

    // Both recordings done → profile builder
    if (candidate.voice_recording_1_url && candidate.voice_recording_2_url) {
      setStep("profile_builder");
      return;
    }

    // Recording 1 done but not 2 → recording 2
    if (candidate.voice_recording_1_url && !candidate.voice_recording_2_url) {
      setStep("voice_recording_2");
      return;
    }

    // Test passed but no recordings → recording 1
    if (candidate.english_mc_score !== null && !candidate.voice_recording_1_url) {
      const passed =
        candidate.english_mc_score >= 70 &&
        (candidate.english_comprehension_score ?? 0) >= 70;
      if (passed) {
        setStep("voice_recording_1");
        return;
      }
    }

    // Fallback
    setStep("device_check");
  }

  // New flow: form → id_consent → id_verification → device_check → test
  function handleFormComplete(data: CandidateData) {
    setCandidateData(data);
    goToStep("id_consent", data.id);
  }

  function handleIDConsentComplete() {
    if (candidateData) {
      setCandidateData({ ...candidateData, id_verification_consent: true });
    }
    goToStep("id_verification", candidateData?.id);
  }

  function handleIDVerificationComplete() {
    if (candidateData) {
      setCandidateData({ ...candidateData, id_verification_status: "passed" });
    }
    goToStep("device_check", candidateData?.id);
  }

  function handleDeviceCheckPass() {
    goToStep("test_instructions");
  }

  function handleTestStart() {
    goToStep("english_test");
  }

  function handleTestComplete(passed: boolean, updatedCandidate: CandidateData) {
    setCandidateData(updatedCandidate);
    setTestPassed(passed);
    if (passed) {
      goToStep("voice_recording_1", updatedCandidate.id);
    } else {
      goToStep("test_result", updatedCandidate.id);
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

    if (allComplete && latest.admin_status !== "approved" && latest.admin_status !== "pending_speaking_review") {
      // Set to pending_speaking_review only when everything is complete
      await supabase
        .from("candidates")
        .update({
          admin_status: "pending_speaking_review",
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
            {["application_form", "english_test", "voice_recording_1", "voice_recording_2", "profile_builder"].map((s, i) => {
              const stepOrder = ["application_form", "device_check", "test_instructions", "english_test", "test_result", "voice_recording_1", "voice_recording_2", "profile_builder"];
              const currentIndex = stepOrder.indexOf(step);
              const thisIndex = stepOrder.indexOf(s);
              const isComplete = currentIndex > thisIndex;
              const isCurrent = step === s || (s === "english_test" && (step === "device_check" || step === "test_instructions" || step === "english_test"));
              return (
                <div key={s} className="flex-1">
                  <div className={`h-1.5 rounded-full ${isComplete ? "bg-primary" : isCurrent ? "bg-primary/50" : "bg-gray-200"}`} />
                  <p className="mt-1 text-[10px] text-text/40 text-center">
                    {["Application", "English Test", "Reading", "Introduction", "Profile"][i]}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {step === "application_form" && (
        <ApplicationForm onComplete={handleFormComplete} />
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
      {step === "device_check" && (
        <DeviceCheck onPass={handleDeviceCheckPass} />
      )}
      {step === "test_instructions" && (
        <TestInstructions onStart={handleTestStart} />
      )}
      {step === "english_test" && candidateData && (
        <EnglishTest
          candidateId={candidateData.id}
          onComplete={handleTestComplete}
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
        <CandidateStatusScreen adminStatus={candidateData.admin_status} />
      )}
    </main>
  );
}
