import { redirect } from "next/navigation";

/**
 * Superseded by /candidate/messages (step 15).
 *
 * The page that lived here had four defects worth recording, because the
 * replacement exists to fix them: a failed load did `if (!res.ok) return;` and
 * painted "No messages yet" over a conversation going back to April; any failed
 * recruiter lookup rendered "No recruiter assigned yet.", which is false for all
 * 242 candidates who have one; timestamps used toLocaleTimeString only, so a
 * 141-day-old message read as "3:07 PM"; and the send had no catch, so a dropped
 * connection left the button disabled forever with nothing said.
 *
 * Kept as a redirect rather than deleted: it is linked from the dashboard and
 * from at least one recruiter surface, and a 404 for someone who has been
 * waiting four months is not an improvement.
 */
export default function RecruiterChatRedirect() {
  redirect("/candidate/messages");
}
