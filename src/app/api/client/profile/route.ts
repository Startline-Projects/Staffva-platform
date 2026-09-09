import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const MAX = { headline: 120, bio: 1200, website_url: 300, timezone: 64, company_name: 160, full_name: 120 };

/** GET /api/client/profile — the signed-in client's own editable profile. */
export async function GET() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const db = admin();
  // Selected column-by-column. `select("*")` here would hand the editor the
  // four dead subscription columns and stripe_customer_id, which has no
  // business leaving the server at all.
  const { data, error } = await db
    .from("clients")
    .select("id, full_name, company_name, email, headline, bio, website_url, timezone, created_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    // The profile columns arrive in the client_profile migration. Until it is
    // applied this select fails as a whole, and the editor has to say it
    // cannot load rather than rendering empty boxes that discard what the
    // client types into them.
    console.error("[client/profile] read failed:", error.message);
    return NextResponse.json({ error: "Could not load your profile." }, { status: 503 });
  }
  if (!data) return NextResponse.json({ error: "Not a client account" }, { status: 403 });

  return NextResponse.json({ profile: data });
}

/** PUT /api/client/profile — save the editable fields. */
export async function PUT(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Allow-listed, not spread. `email` is NOT here: it is the login identity,
  // and changing it through a profile form would silently move the account.
  const patch: Record<string, string | null> = {};
  for (const key of ["full_name", "company_name", "headline", "bio", "website_url", "timezone"] as const) {
    if (!(key in body)) continue;
    const raw = body[key];
    if (raw !== null && typeof raw !== "string") {
      return NextResponse.json({ error: `${key} must be text.` }, { status: 400 });
    }
    const trimmed = raw === null ? "" : raw.trim();
    if (trimmed.length > MAX[key]) {
      return NextResponse.json(
        { error: `Keep ${key.replace(/_/g, " ")} under ${MAX[key]} characters.` },
        { status: 400 }
      );
    }
    patch[key] = trimmed === "" ? null : trimmed;
  }

  // full_name is what a candidate sees on every offer and email from this
  // client. Blanking it would leave them dealing with "A client".
  if ("full_name" in patch && patch.full_name === null) {
    return NextResponse.json({ error: "Your name can't be empty." }, { status: 400 });
  }

  if (patch.website_url) {
    // Stored with a scheme so the anchor cannot become a relative link, and
    // restricted to http(s) so a saved `javascript:` URL can never be
    // rendered as a clickable link on the candidate's page.
    const withScheme = /^https?:\/\//i.test(patch.website_url)
      ? patch.website_url
      : `https://${patch.website_url}`;
    let parsed: URL;
    try {
      parsed = new URL(withScheme);
    } catch {
      return NextResponse.json({ error: "That doesn't look like a web address." }, { status: 400 });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return NextResponse.json({ error: "Links must start with http:// or https://." }, { status: 400 });
    }
    patch.website_url = parsed.toString();
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  }

  const db = admin();
  const { data, error } = await db
    .from("clients")
    .update(patch)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[client/profile] save failed:", error.message);
    return NextResponse.json({ error: "We couldn't save your profile." }, { status: 500 });
  }
  // Checked, rather than reporting success on an update that matched no row.
  if (!data) return NextResponse.json({ error: "Not a client account" }, { status: 403 });

  return NextResponse.json({ ok: true });
}
