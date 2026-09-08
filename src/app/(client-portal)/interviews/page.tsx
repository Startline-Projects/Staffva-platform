import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import InterviewsView from "@/components/client/portal/InterviewsView";

/**
 * Interviews (Atlas step 10) — the client's own schedule.
 *
 * The rail pointed at /team#interviews, a section of the dashboard. This is
 * the page it should have pointed at, and it is where the reschedule flow
 * lives — the one Atlas draws three buttons for and never implements.
 */
export default async function InterviewsPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/interviews");
  return <InterviewsView />;
}
