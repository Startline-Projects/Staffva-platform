"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import USExperiencePicker, {
  DURATION_VALUES,
  NO_VALUES,
} from "@/components/candidate/USExperiencePicker";

export default function UsExperienceGatePage() {
  const router = useRouter();
  const [value, setValue] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!value) {
      setError("Please answer the question and select an option.");
      return;
    }
    if (!DURATION_VALUES.includes(value) && !NO_VALUES.includes(value)) {
      setError("Please select a valid option.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("Not authenticated.");
      setLoading(false);
      return;
    }

    const { error: updateErr } = await supabase
      .from("candidates")
      .update({ us_client_experience: value })
      .eq("user_id", user.id);

    if (updateErr) {
      setError("Failed to save: " + updateErr.message);
      setLoading(false);
      return;
    }

    router.push("/candidate/dashboard");
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-text">One quick question before you continue</h1>
        <p className="mt-2 text-sm text-text/60">
          We updated how we ask about US client experience. Please answer to continue.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <USExperiencePicker value={value} onChange={setValue} disabled={loading} />

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {loading ? "Saving..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
