import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { loadCandidateThread } from "@/lib/recruiterThread";
import AtlasMessages from "@/components/candidate/portal/AtlasMessages";

/**
 * The candidate's messages — the Atlas messages view: one conversation list
 * (assigned specialist + every client thread), filters, search, day
 * dividers, bubbles, system cards, realtime. The step-15 accordion this
 * replaces split the same data across two stacked components.
 *
 * What carries over unchanged from step 15's findings:
 *  - Deliberately NOT gated on admin_status === "approved". One candidate on
 *    an 'active' account had two unread replies waiting since April because
 *    no screen ever showed them a way in. Anyone with an assigned specialist
 *    can reach their own conversation.
 *  - A candidate sending a message still creates no email and no
 *    notification for staff — the daily escalation cron is what gets
 *    specialist threads answered, and the in-thread footnote says exactly
 *    that much and no more.
 *  - Candidates REPLY to clients, never initiate; the API enforces it, so
 *    every client thread in the list is one a client already opened.
 */
export default async function CandidateMessagesPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/candidate/messages");
  if (user.app_metadata?.role !== "candidate") redirect("/dashboard");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: candidate, error } = await admin
    .from("candidates")
    .select("id, first_name, display_name, assigned_recruiter")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw new Error(`candidate lookup failed: ${error.message}`);
  if (!candidate) redirect("/candidate/dashboard");

  const { messages, state } = await loadCandidateThread(candidate.id);

  return (
    <AtlasMessages
      candidateId={candidate.id}
      specialist={
        state.assigneeId
          ? { assigneeId: state.assigneeId, assigneeName: state.assigneeName }
          : null
      }
      specialistMessages={messages}
      specialistUnread={state.unreadByCandidate}
      awaitingReply={state.awaitingReply}
    />
  );
}
