import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import Navbar from "@/components/Navbar";
import { loadCandidateThread } from "@/lib/recruiterThread";
import MessageThread from "@/components/candidate/MessageThread";

/**
 * The candidate's messages.
 *
 * This is the one messaging channel on the platform that people actually use —
 * and it has been failing them. Ten candidates have written to their assigned
 * specialist; seven have never had a reply; nine are waiting now, eight of them
 * since April; the longest has waited 141 days.
 *
 * The cause looks structural rather than personal. A candidate sending a message
 * creates no email (candidate mail is frozen) and no notification of any kind —
 * recruiter_notifications holds 39 rows, all unread, none about a message — so
 * the only way a recruiter learns of one is by choosing to open the chat. Step
 * 15 pairs this page with a staff triage screen and a daily escalation, because
 * a nicer thread on its own would not get anyone an answer.
 *
 * Deliberately NOT gated on admin_status === "approved", unlike
 * /candidate/work. One candidate on an 'active' account has had two unread
 * replies waiting since April because no screen has ever shown them a way in.
 * Anyone with an assigned specialist can reach their own conversation.
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
    <>
      <Navbar />
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-[#1C1B1A]">Messages</h1>
          {state.assigneeName ? (
            <p className="mt-1 text-sm text-gray-600">
              Your conversation with{" "}
              <span className="font-medium text-[#1C1B1A]">{state.assigneeName}</span>, your
              talent specialist.
            </p>
          ) : (
            // Only said when assigned_recruiter really is null — never as a
            // fallback for a failed request, which is what the previous page
            // did for all 242 candidates who do have one.
            <p className="mt-1 text-sm text-gray-600">
              You don&apos;t have a talent specialist assigned yet.
            </p>
          )}
        </div>

        {state.assigneeId ? (
          <MessageThread initialMessages={messages} />
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <p className="text-sm text-gray-600">
              Once someone is assigned to you, your conversation with them appears here.
            </p>
          </div>
        )}

        {state.awaitingReply && (
          <p className="mt-4 text-xs leading-relaxed text-gray-500">
            {/* Says only what the code performs. The cron does run daily and
                does send the list to staff — but "reviewed daily" would promise
                that a person acts on it, which nothing here can make true, and
                which the last four months say is not the case. */}
            If nobody answers within two days, your message is added to a list
            that goes to our team every day.
          </p>
        )}

        <p className="mt-8 text-xs text-gray-400">
          <Link href="/candidate/dashboard" className="hover:underline">
            Back to dashboard
          </Link>
        </p>
      </div>
    </>
  );
}
