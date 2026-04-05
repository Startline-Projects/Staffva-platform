"use client";

export default function PostTestVerification({ onVerify }: { onVerify: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-6 py-16 text-center">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
        <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </div>

      <h1 className="text-2xl font-bold text-[#1C1B1A]">Your assessment has been submitted</h1>

      <p className="mt-4 text-sm text-gray-500 leading-relaxed">
        Before we show your results, please verify your identity. This takes less than 2 minutes and is required to protect the integrity of every profile on StaffVA.
      </p>

      <button
        onClick={onVerify}
        className="mt-8 w-full rounded-full bg-[#FE6E3E] py-3.5 text-sm font-semibold text-white hover:bg-[#E55A2B] transition-colors"
      >
        Verify My Identity
      </button>

      <p className="mt-4 text-xs text-gray-400">
        Your test results are saved and will be displayed after verification.
      </p>
    </div>
  );
}
