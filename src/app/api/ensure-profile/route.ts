import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { COUNTRIES } from "@/lib/atlasCountries";
import {
  SIGNUP_ROLE_CATEGORIES as SIGNUP_ROLE_CATEGORY_LIST,
  CLIENT_REFERRAL_SOURCES as CLIENT_REFERRAL_SOURCE_LIST,
  sanitizeHiringFor,
} from "@/lib/signupCapture";

// Both vocabularies come from src/lib/signupCapture.ts so the pages and this
// route cannot drift; the DB keeps frozen copies in migration 00226's CHECK
// constraints and handle_new_user allowlists.
const SIGNUP_ROLE_CATEGORIES = new Set(SIGNUP_ROLE_CATEGORY_LIST);
const CLIENT_REFERRAL_SOURCES = new Set(CLIENT_REFERRAL_SOURCE_LIST.map((r) => r.value));
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
      hiringFor?: string[];
      referralSource?: string;
    };
  };

  if (!userId || !email || !role) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // NOTE on who actually writes what: since 00205 the handle_new_user
  // trigger creates the profiles row (and the clients row for role
  // 'client') inside auth.signUp itself, and since 00226 it persists the
  // signup capture from raw_user_meta_data. When the trigger succeeded,
  // both upserts below hit ON CONFLICT DO NOTHING — this route is the BELT
  // for the trigger's swallowed-exception path, so its inserts carry the
  // same capture fields. Because the upserts ignore duplicates, this
  // unauthenticated route can never modify an EXISTING row's consent or
  // attribution fields (it could, briefly; review caught it).
  let signupFields: Record<string, unknown> = {};
  // Client-only capture, validated the same way and written onto the clients
  // row below (the profiles columns are role-agnostic; these two aren't).
  let clientSignupFields: Record<string, unknown> = {};
  if ((role === "candidate" || role === "client") && signup) {
    if (signup.termsAccepted !== true || signup.ageConfirmed !== true) {
      return NextResponse.json(
        { error: "Terms agreement and age confirmation are required" },
        { status: 400 }
      );
    }
    const country = signup.country && COUNTRY_NAMES.has(signup.country) ? signup.country : null;
    const stamp = new Date().toISOString();
    signupFields = {
      signup_country: country,
      terms_accepted_at: stamp,
      age_confirmed_at: stamp,
      marketing_opt_in: !!signup.marketingOptIn,
    };
    if (role === "candidate") {
      const roleCategory = signup.roleCategory && SIGNUP_ROLE_CATEGORIES.has(signup.roleCategory) ? signup.roleCategory : null;
      const referral = (signup.referralCode || "").trim();
      const referralCode = /^[A-Za-z0-9_-]{1,64}$/.test(referral) ? referral : null;
      signupFields.signup_role_category = roleCategory;
      signupFields.referral_code = referralCode;
    } else {
      const hiringFor = sanitizeHiringFor(signup.hiringFor);
      clientSignupFields = {
        hiring_for: hiringFor.length > 0 ? hiringFor : null,
        referral_source:
          signup.referralSource && CLIENT_REFERRAL_SOURCES.has(signup.referralSource)
            ? signup.referralSource
            : null,
      };
    }
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
          ...clientSignupFields,
        },
        { onConflict: "user_id", ignoreDuplicates: true }
      );

    if (clientError) {
      console.error("ensure-profile: client upsert failed:", clientError);
    }

    // A client account without a clients row cannot post jobs, send offers,
    // or fund anything — swallowing that here let the signup page show
    // success over a broken account (review caught it). The upsert error
    // alone isn't the signal (DO NOTHING is a benign non-write when the
    // trigger already created the row), so verify the row actually exists.
    const { data: clientRow, error: checkError } = await supabase
      .from("clients")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (checkError || !clientRow) {
      console.error("ensure-profile: clients row missing after upsert:", checkError);
      return NextResponse.json(
        { error: "Client record could not be created" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ ok: true });
}
