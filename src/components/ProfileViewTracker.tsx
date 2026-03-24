"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ProfileViewTracker({ candidateId }: { candidateId: string }) {
  useEffect(() => {
    async function recordView() {
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        await fetch("/api/profile-views", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ candidate_id: candidateId }),
        });
      } catch {
        // Silent — don't interrupt profile viewing
      }
    }
    recordView();
  }, [candidateId]);

  return null; // Invisible component
}
