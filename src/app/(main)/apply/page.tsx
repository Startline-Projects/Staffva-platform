"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import ApplicationForm from "@/components/apply/ApplicationForm";
import DeviceCheck from "@/components/apply/DeviceCheck";
import TestInstructions from "@/components/apply/TestInstructions";
import EnglishTest from "@/components/apply/EnglishTest";
import TestResult from "@/components/apply/TestResult";
import IDVerification from "@/components/apply/IDVerification";
import VoiceRecording1 from "@/components/apply/VoiceRecording1";
import VoiceRecording2 from "@/components/apply/VoiceRecording2";
import ProfileBuilder from "@/components/apply/ProfileBuilder";

export type ApplicationStep =
  | "loading"
  | "application_form"
  | "device_check"
  | "test_instructions"
  | "english_test"
  | "test_result"
  | "id_verification"
  | "voice_recording_1"
  | "voice_recording_2"
  | "profile_builder"
  | "complete";

export interface CandidateData {
  id: string;
  full_name: string;
  email: string;
  country: string;
  role_category: string;
  years_experience: string;
  monthly_rate: number;
  time_zone: string;
  linkedin_url: string;
  bio: string;
  us_client_experience: string;
  us_client_description: string;
  english_mc_score: number | null;
  english_comprehension_score: number | null;
  english_percentile: number | null;
  english_written_tier: string | null;
  admin_status: string;
  id_verification_status: string;
  voice_recording_1_url: string | null;
  voice_recording_2_url: string | null;
  resume_url: string | null;
  availability_status: string;
  permanently_blocked: boolean;
  retake_count: number;
  retake_available_at: string | null;
}

export default function ApplyPage() {
  const [step, setStep] = useState<ApplicationStep>("loading");
  const [candidateData, setCandidateData] = useState<CandidateData | null>(
    null
  );
  const [testPassed, setTestPassed] = useState(false);

  useEffect(() => {
    loadCandidateState();
  }, []);

  async function loadCandidateState() {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

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

    // Determine current step based on candidate state
    if (candidate.permanently_blocked) {
      setStep("test_result");
      return;
    }

    if (candidate.admin_status === "approved") {
      setStep("complete");
      return;
    }

    if (candidate.admin_status === "pending_speaking_review") {
      setStep("complete");
      return;
    }

    // Has resume = profile built, waiting for review
    if (candidate.resume_url) {
      setStep("complete");
      return;
    }

    // Has both recordings = go to profile builder
    if (candidate.voice_recording_1_url && candidate.voice_recording_2_url) {
      setStep("profile_builder");
      return;
    }

    // Has recording 1 = go to recording 2
    if (candidate.voice_recording_1_url) {
      setStep("voice_recording_2");
      return;
    }

    // Has test scores = check pass/fail, then ID verification, then recordings
    if (candidate.english_mc_score !== null) {
      const passed =
        candidate.english_mc_score >= 70 &&
        (candidate.english_comprehension_score ?? 0) >= 70;
      setTestPassed(passed);

      if (!passed) {
        setStep("test_result");
        return;
      }

      // Passed test — check ID verification status
      if (
        candidate.id_verification_status !== "passed"
      ) {
        setStep("id_verification");
        return;
      }

      // ID verified — go to recordings
      setStep("voice_recording_1");
      return;
    }

    // No test score = start from device check
    setStep("device_check");
  }

  function handleFormComplete(data: CandidateData) {
    setCandidateData(data);
    setStep("device_check");
  }

  function handleDeviceCheckPass() {
    setStep("test_instructions");
  }

  function handleTestStart() {
    setStep("english_test");
  }

  function handleTestComplete(
    passed: boolean,
    updatedCandidate: CandidateData
  ) {
    setCandidateData(updatedCandidate);
    setTestPassed(passed);
    if (passed) {
      // v5: after passing test, go to ID verification (not recordings)
      setStep("id_verification");
    } else {
      setStep("test_result");
    }
  }

  function handleIDVerificationComplete() {
    // After ID verification passes, proceed to voice recordings
    setStep("voice_recording_1");
  }

  function handleRecording1Complete(url: string) {
    setCandidateData((prev) =>
      prev ? { ...prev, voice_recording_1_url: url } : prev
    );
    setStep("voice_recording_2");
  }

  function handleRecording2Complete(url: string) {
    setCandidateData((prev) =>
      prev ? { ...prev, voice_recording_2_url: url } : prev
    );
    setStep("profile_builder");
  }

  function handleProfileComplete() {
    setStep("complete");
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
      {step === "application_form" && (
        <ApplicationForm onComplete={handleFormComplete} />
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
      {step === "id_verification" && candidateData && (
        <IDVerification
          candidateId={candidateData.id}
          verificationStatus={candidateData.id_verification_status}
          onComplete={handleIDVerificationComplete}
        />
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
          candidate={candidateData}
          onComplete={handleProfileComplete}
        />
      )}
      {step === "complete" && candidateData && (
        <div className="mx-auto max-w-xl px-6 py-16 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-text">
            {candidateData.admin_status === "approved"
              ? "Your Profile is Live"
              : "Application Complete"}
          </h1>
          <p className="mt-3 text-text/60">
            {candidateData.admin_status === "approved"
              ? "Your profile is live and visible to clients. You will be notified when a client sends you a message."
              : "Your profile is complete and under review. We will notify you within 2 business days once your speaking assessment is complete and your profile is live."}
          </p>
        </div>
      )}
    </main>
  );
}
