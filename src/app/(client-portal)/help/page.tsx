import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import HelpBrowse from "@/components/client/portal/HelpBrowse";

/**
 * Help Center (Atlas step 22), inside the client portal.
 *
 * The sidebar's Help row was a mailto: link. It still is, at the bottom of
 * this page — email remains the only human support channel, and owner
 * decision D5 rules out a talent specialist on the client side, so there is
 * no "Ask Alex" and nothing here promises a reply time we do not measure.
 */
export default async function HelpPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/help");
  return <HelpBrowse />;
}
