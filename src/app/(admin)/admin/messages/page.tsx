import Link from "next/link";
import { loadAwaitingThreads } from "@/lib/recruiterThread";
import AdminMessageReply from "@/components/admin/AdminMessageReply";

/**
 * Every candidate waiting on a reply, oldest first.
 *
 * This screen is the point of step 15. Nine candidates are waiting; eight have
 * been waiting since April; seven have never had any reply at all. Three of
 * those threads belong to the recruiting_manager and have never been renderable
 * on any screen in this product — the recruiter dashboard short-circuits before
 * fetching threads for a manager, and the old RLS policy required
 * profiles.role = 'recruiter'. Migration 00194 and this page fix that together.
 *
 * Reached by admin and recruiting_manager, both of whom the (admin) layout
 * already admits.
 *
 * Worth being plain about the limit: no product change can make anyone answer.
 * This puts the nine in front of whoever does sign in, and the daily cron
 * pushes the same list to Slack and staff email for whoever does not.
 */
export const dynamic = "force-dynamic";

function tone(days: number | null): string {
  if (days === null) return "bg-gray-300";
  if (days >= 30) return "bg-red-500";
  if (days >= 7) return "bg-amber-500";
  return "bg-green-500";
}

export default async function AdminMessagesPage() {
  const threads = await loadAwaitingThreads();

  const byAssignee = new Map<string, number>();
  for (const t of threads) {
    const k = t.assigneeName ?? "Unassigned";
    byAssignee.set(k, (byAssignee.get(k) ?? 0) + 1);
  }

  const overWeek = threads.filter((t) => (t.daysWaiting ?? 0) >= 7).length;
  const neverAnswered = threads.filter((t) => !t.everReplied).length;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[#1C1B1A]">Unanswered messages</h1>
        <p className="mt-1 text-sm text-gray-600">
          Candidates who have written and had no reply since. Oldest first.
        </p>
      </div>

      {threads.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <p className="text-sm text-gray-600">Nobody is waiting on a reply.</p>
        </div>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-3">
            <span className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm">
              <strong className="text-[#1C1B1A]">{threads.length}</strong>{" "}
              <span className="text-gray-500">waiting</span>
            </span>
            <span className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm">
              <strong className="text-red-800">{overWeek}</strong>{" "}
              <span className="text-red-700">over a week</span>
            </span>
            <span className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm">
              <strong className="text-red-800">{neverAnswered}</strong>{" "}
              <span className="text-red-700">never had any reply</span>
            </span>
          </div>

          {byAssignee.size > 0 && (
            <p className="mb-5 text-xs text-gray-500">
              By specialist:{" "}
              {[...byAssignee.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([name, n]) => `${name} (${n})`)
                .join(" · ")}
            </p>
          )}

          <div className="space-y-3">
            {threads.map((t) => (
              <div key={t.candidateId} className="rounded-lg border border-gray-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2 w-2 shrink-0 rounded-full ${tone(t.daysWaiting)}`}
                        aria-hidden
                      />
                      <Link
                        href={`/candidate/${t.candidateId}`}
                        className="text-sm font-semibold text-[#1C1B1A] hover:underline"
                      >
                        {t.candidateName ?? "Candidate"}
                      </Link>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      Waiting <strong className="text-[#1C1B1A]">{t.daysWaiting} days</strong>
                      {t.unansweredCount > 1 ? ` · ${t.unansweredCount} messages` : ""}
                      {t.everReplied ? "" : " · never had a reply"}
                      {t.assigneeName ? ` · ${t.assigneeName}` : " · unassigned"}
                      {t.assigneeRole === "recruiting_manager" ? " (manager)" : ""}
                    </p>
                  </div>
                </div>

                <AdminMessageReply
                  candidateId={t.candidateId}
                  candidateName={t.candidateName ?? "this candidate"}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
