import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { twilioConfigured } from "@/lib/twilioVerify";
import { COUNTRIES } from "@/lib/atlasCountries";
import VerifyPhoneClient from "./VerifyPhoneClient";

export const metadata = { title: "Verify your WhatsApp — StaffVA" };

/**
 * Step 2 of the Atlas pipeline: WhatsApp verification. The server half only
 * answers three questions — who is this, is their phone already verified,
 * and is Twilio configured — and hands the state machine to the client.
 */
export default async function VerifyPhonePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/verify-phone");

  const { data: profile } = await supabase
    .from("profiles")
    .select("phone_number, phone_verified_at, signup_country")
    .eq("id", user.id)
    .maybeSingle();

  // Preselect the dial code from the signup country. PH fallback is the
  // honest default: it is where most of the supply side actually is.
  const defaultCountry = COUNTRIES.find((c) => c.name === profile?.signup_country)?.code || "PH";

  return (
    <VerifyPhoneClient
      enabled={twilioConfigured()}
      verifiedPhone={profile?.phone_verified_at ? profile?.phone_number || null : null}
      defaultCountry={defaultCountry}
    />
  );
}
