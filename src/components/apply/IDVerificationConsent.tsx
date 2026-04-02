"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Props {
  candidateId: string;
  onConsented: () => void;
}

export default function IDVerificationConsent({ candidateId, onConsented }: Props) {
  const [consented, setConsented] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleContinue() {
    if (!consented) return;
    setLoading(true);
    setError("");

    try {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("candidates")
        .update({
          id_verification_consent: true,
          id_verification_consent_at: new Date().toISOString(),
          id_verification_consent_version: "v1.0",
        })
        .eq("id", candidateId);

      if (updateError) {
        setError("Failed to save consent. Please try again.");
        setLoading(false);
        return;
      }

      onConsented();
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <h1 className="text-2xl font-bold text-[#1C1B1A]">Verify your identity to continue</h1>

      <p className="mt-4 text-sm text-gray-600 leading-relaxed">
        StaffVA verifies every professional&apos;s identity before they take the English assessment.
        This protects you and every client on the platform — every profile on StaffVA is a real,
        verified person. Powered by Stripe Identity.
      </p>

      {/* Stripe Identity badge */}
      <div className="mt-6 flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#635BFF]/10">
          <svg className="h-5 w-5 text-[#635BFF]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-7.076-2.19l-.89 5.494C5.108 22.88 8.09 24 11.5 24c2.64 0 4.862-.627 6.425-1.818 1.663-1.262 2.564-3.162 2.564-5.51 0-4.132-2.56-5.834-6.513-7.522z" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium text-[#1C1B1A]">Powered by Stripe Identity</p>
          <p className="text-xs text-gray-500">Secure, encrypted identity verification</p>
        </div>
      </div>

      {/* Data collection details */}
      <div className="mt-6 space-y-4">
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <ul className="space-y-4 text-sm text-gray-600">
            <li className="flex gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50">
                <svg className="h-3.5 w-3.5 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-[#1C1B1A]">What we collect</p>
                <p className="mt-0.5 text-gray-500">Your government-issued ID and a selfie, processed by Stripe.</p>
              </div>
            </li>
            <li className="flex gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-50">
                <svg className="h-3.5 w-3.5 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-[#1C1B1A]">How it&apos;s used</p>
                <p className="mt-0.5 text-gray-500">Identity verification and ensuring one application per person.</p>
              </div>
            </li>
            <li className="flex gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-50">
                <svg className="h-3.5 w-3.5 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-[#1C1B1A]">How long it&apos;s stored</p>
                <p className="mt-0.5 text-gray-500">Per Stripe&apos;s data retention policy, accessible in your <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer" className="text-[#FE6E3E] underline">Stripe Privacy Policy</a>.</p>
              </div>
            </li>
            <li className="flex gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-50">
                <svg className="h-3.5 w-3.5 text-purple-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-[#1C1B1A]">Your rights</p>
                <p className="mt-0.5 text-gray-500">You may request deletion of your data at any time by contacting <a href="mailto:support@staffva.com" className="text-[#FE6E3E] underline">support@staffva.com</a>.</p>
              </div>
            </li>
          </ul>
        </div>
      </div>

      {/* Consent checkbox */}
      <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={consented}
            onChange={(e) => setConsented(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#FE6E3E] focus:ring-[#FE6E3E]"
          />
          <span className="text-sm text-gray-700 leading-relaxed">
            I consent to identity verification as described above. I understand my data is processed by Stripe and used to verify my identity and prevent duplicate applications.
          </span>
        </label>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <button
        onClick={handleContinue}
        disabled={!consented || loading}
        className="mt-6 w-full rounded-lg bg-[#FE6E3E] px-4 py-3 text-sm font-semibold text-white hover:bg-[#E55A2B] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Saving..." : "Continue to Verification"}
      </button>

      <p className="mt-3 text-center text-xs text-gray-400">
        This verification takes about 60 seconds. Have your government-issued ID ready.
      </p>
    </div>
  );
}
