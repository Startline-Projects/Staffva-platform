"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ROLES = [
  "Admin",
  "Bookkeeping/AP",
  "Paralegal",
  "VA",
  "Scheduling",
  "Customer Support",
  "Legal Assistant",
];

export default function QuickMatchButton() {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState("");
  const [hours, setHours] = useState("");
  const [timing, setTiming] = useState("");
  const router = useRouter();

  function handleSubmit() {
    const params = new URLSearchParams();
    if (role) params.set("role", role);
    if (timing === "Now") params.set("availability", "available_now");
    router.push(`/browse?${params.toString()}`);
    setOpen(false);
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-primary px-5 py-3.5 text-sm font-semibold text-white shadow-lg hover:bg-primary-dark transition-all hover:scale-105"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        Quick Match
      </button>

      {/* Modal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-2xl relative">
            {/* Close */}
            <button
              onClick={() => setOpen(false)}
              className="absolute top-4 right-4 text-text/40 hover:text-text transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <h3 className="text-xl font-bold text-text">Quick Match</h3>
            <p className="mt-1 text-sm text-text/60">
              Answer 3 questions. See matched candidates in 30 seconds.
            </p>

            {/* Q1 — Role */}
            <div className="mt-6">
              <label className="block text-sm font-medium text-text">
                What role do you need?
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-text focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">Select a role...</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            {/* Q2 — Hours */}
            <div className="mt-5">
              <label className="block text-sm font-medium text-text">
                How many hours per week?
              </label>
              <div className="mt-1.5 flex gap-3">
                {["Full Time", "Part Time"].map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setHours(opt)}
                    className={`flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                      hours === opt
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-gray-300 text-text/70 hover:border-primary/30"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            {/* Q3 — Timing */}
            <div className="mt-5">
              <label className="block text-sm font-medium text-text">
                When do you need them?
              </label>
              <div className="mt-1.5 flex gap-3">
                {["Now", "Within 2 weeks", "No rush"].map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setTiming(opt)}
                    className={`flex-1 rounded-lg border px-3 py-2.5 text-xs sm:text-sm font-medium transition-colors ${
                      timing === opt
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-gray-300 text-text/70 hover:border-primary/30"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              className="mt-8 w-full rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-white hover:bg-primary-dark transition-colors"
            >
              Show me candidates
            </button>
          </div>
        </div>
      )}
    </>
  );
}
