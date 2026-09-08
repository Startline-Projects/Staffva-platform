import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import InboxClient from "@/components/inbox/InboxClient";

/**
 * /inbox — now a fork, not a destination for clients.
 *
 * Client step 12 moved the client's messages into the portal at /messages,
 * on the Atlas markup and a realtime socket. This page kept working, which
 * is the problem: emails, bells, the dashboard and nine internal links all
 * still point here, so a client could sit on the old 30-second-poll page
 * while the candidate's half of the same conversation ran live. One object,
 * two surfaces, and the older one silently worse.
 *
 * Rather than rewrite every link, clients are forwarded — query and all — so
 * a deep link like /inbox?candidate=… lands on the right thread either way.
 *
 * This page stays for CANDIDATES, not recruiters: /api/messages only resolves
 * a record id for roles client and candidate, so a recruiter opening it sees
 * a permanently empty list and belongs on /recruiter instead. Worth stating,
 * because anyone deleting "the recruiter page nobody uses" would take the
 * candidates' fallback with it.
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getUser();
  if (!user) redirect("/login?next=/inbox");

  if (user.app_metadata?.role === "client") {
    const sp = await searchParams;
    const qs = new URLSearchParams();
    // Only the deep-link params travel; `client` is redundant once the portal
    // resolves the caller's own id server-side.
    const candidate = sp.candidate;
    if (typeof candidate === "string") qs.set("candidate", candidate);
    redirect(qs.toString() ? `/messages?${qs}` : "/messages");
  }

  return <InboxClient />;
}
