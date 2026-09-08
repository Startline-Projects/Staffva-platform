import { createBrowserClient } from "@supabase/ssr";
import { cookieDomainForHost } from "./cookieDomain";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Same scope the server writes at. If the browser client wrote host-only
      // cookies while the server wrote shared ones, a token refresh in the tab
      // would create a second cookie of the same name at a narrower scope —
      // and the narrower one shadows the real session on the host that set it.
      // The two halves have to agree.
      cookieOptions: {
        domain:
          typeof window !== "undefined"
            ? cookieDomainForHost(window.location.host)
            : undefined,
      },
    }
  );
}
