import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Get user role to redirect appropriately
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const role = user?.user_metadata?.role;

      if (role === "candidate") {
        return NextResponse.redirect(`${origin}/apply`);
      } else if (role === "client") {
        return NextResponse.redirect(`${origin}/browse`);
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Auth error — redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth`);
}
