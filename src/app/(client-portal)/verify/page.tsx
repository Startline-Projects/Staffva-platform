import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import VerifyToFund from "@/components/client/portal/VerifyToFund";

/**
 * Verify to fund (Atlas step 13, rescoped to what exists).
 *
 * The prototype walks five panes — welcome, personal info, ID upload, selfie
 * capture, card — all simulated: no camera opens, nothing is tokenised, no
 * server is involved, and a page refresh un-verifies you. Three of those
 * panes are Stripe Identity's own hosted flow here, which is where the
 * document and the selfie actually go, so they are not rebuilt as local
 * forms that would only pretend to collect them.
 *
 * What remains is honest: consent, a handoff to Stripe Identity, and a card
 * saved with a SetupIntent.
 */
export default async function VerifyPage() {
  const user = await getUser();
  if (!user) redirect("/login?next=/verify");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: base } = await admin
    .from("clients")
    .select("id, full_name")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!base) redirect("/team");

  // The verification columns arrive in migration 00225. Before it lands this
  // read fails, and throwing here would 500 the ONE page that fixes the
  // state the funding gate is refusing on — so it degrades to "we can't read
  // your status" instead. (The layout takes the same position; review caught
  // the two files disagreeing about it.)
  const { data: client, error } = await admin
    .from("clients")
    .select(
      "id_verification_status, id_verification_reviewed_by, payment_method_brand, payment_method_last4, payment_method_exp_month, payment_method_exp_year"
    )
    .eq("id", base.id)
    .maybeSingle();
  if (error || !client) {
    return (
      <section className="vf-wrap">
        <div className="vf-card">
          <h2>We can&apos;t read your verification status right now</h2>
          <p className="vf-card-sub">
            Nothing is wrong with your account. Try again in a few minutes, or
            email <a href="mailto:support@staffva.com">support@staffva.com</a> if it
            keeps happening.
          </p>
        </div>
      </section>
    );
  }

  return (
    <VerifyToFund
      status={client.id_verification_status ?? "unverified"}
      humanReviewed={!!client.id_verification_reviewed_by}
      card={
        client.payment_method_last4
          ? {
              brand: client.payment_method_brand,
              last4: client.payment_method_last4,
              expMonth: client.payment_method_exp_month,
              expYear: client.payment_method_exp_year,
            }
          : null
      }
    />
  );
}
