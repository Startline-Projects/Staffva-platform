import { Suspense } from "react";
import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import ClientMessages from "@/components/client/portal/ClientMessages";

/**
 * Messages (Atlas step 9), inside the client portal.
 *
 * The rail pointed at /inbox — a two-panel Tailwind page in the (main) group
 * that polled every 30 seconds while the candidate's half of the very same
 * conversation ran on a realtime socket. This is the client's side of
 * AtlasMessages, on the same markup and the same subscription.
 *
 * clientId is resolved here rather than in the browser: the realtime filter
 * (`client_id=eq.…`) needs it before the first render, and a client should
 * not have to make a round trip to learn their own id.
 */
export default async function ClientMessagesPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/messages");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: client, error } = await admin
    .from("clients")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  // Fail loud rather than rendering an empty inbox: "you have no messages" and
  // "we could not look you up" are different sentences.
  if (error) throw new Error(`client lookup failed: ${error.message}`);
  if (!client) redirect("/team");

  return (
    <Suspense fallback={<p style={{ padding: 24, fontSize: 13 }}>Loading messages…</p>}>
      <ClientMessages clientId={client.id} />
    </Suspense>
  );
}
