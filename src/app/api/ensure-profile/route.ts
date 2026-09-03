import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { COUNTRIES } from "@/lib/atlasCountries";

const SIGNUP_ROLE_CATEGORIES = new Set([
  "Paralegal", "Legal Assistant", "Bookkeeping/AP", "Admin", "VA", "Cold Caller",
  "Sales", "SDR", "SEO", "Marketing", "Scheduling", "Customer Support",
  "Medical", "E-Commerce", "Other",
]);
const COUNTRY_NAMES = new Set(COUNTRIES.map((c) => c.name));

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: Request) {
  // An empty or non-JSON body made request.json() throw before any handling,
  // producing an unhandled 500. Parse defensively and answer 400 instead.
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { userId, email, role, fullName, companyName, signup } = payload as {
    userId?: string; email?: string; role?: string; fullName?: string; companyName?: string;
    signup?: {
      country?: string;
      roleCategory?: string;
      termsAccepted?: boolean;
      ageConfirmed?: boolean;
      marketingOptIn?: boolean;
      referralCode?: string;
    };
  };

  if (!userId || !email || !role) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // Signup capture is validated BEFORE any write, and its fields ride inside
  // the create payload below. That makes the capture atomic with profile
  // creation, and — because the upsert ignores duplicates — means this
  // unauthenticated route can never modify an EXISTING profile's consent or
  // attribution fields (it could, briefly; review caught it).
  let signupFields: Record<string, unknown> = {};
  if (role === "candidate" && signup) {
    if (signup.termsAccepted !== true || signup.ageConfirmed !== true) {
      return NextResponse.json(
        { error: "Terms agreement and age confirmation are required" },
        { status: 400 }
      );
    }
    const country = signup.country && COUNTRY_NAMES.has(signup.country) ? signup.country : null;
    const roleCategory = signup.roleCategory && SIGNUP_ROLE_CATEGORIES.has(signup.roleCategory) ? signup.roleCategory : null;
    const referral = (signup.referralCode || "").trim();
    const referralCode = /^[A-Za-z0-9_-]{1,64}$/.test(referral) ? referral : null;
    const stamp = new Date().toISOString();
    signupFields = {
      signup_country: country,
      signup_role_category: roleCategory,
      terms_accepted_at: stamp,
      age_confirmed_at: stamp,
      marketing_opt_in: !!signup.marketingOptIn,
      referral_code: referralCode,
    };
  }

  const supabase = getAdminClient();

  // Upsert profile — create if missing, skip if exists
  const { error: profileError } = await supabase
    .from("profiles")
    .upsert(
      {
        id: userId,
        email,
        role,
        full_name: fullName || "",
        ...signupFields,
      },
      { onConflict: "id", ignoreDuplicates: true }
    );

  if (profileError) {
    console.error("ensure-profile: profile upsert failed:", profileError);
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  // If client, also ensure clients row exists
  if (role === "client") {
    const { error: clientError } = await supabase
      .from("clients")
      .upsert(
        {
          user_id: userId,
          full_name: fullName || "",
          email,
          company_name: companyName || null,
        },
        { onConflict: "user_id", ignoreDuplicates: true }
      );

    if (clientError) {
      console.error("ensure-profile: client upsert failed:", clientError);
      // Non-fatal — profile was created
    }
  }

  return NextResponse.json({ ok: true });
}
