import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";
import { createCalendarWatch } from "@/lib/google-calendar";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

function verifyState(state: string): { userId: string } | null {
  const secret = process.env.GOOGLE_OAUTH_STATE_SECRET;
  if (!secret) return null;
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const [userId, issuedAtStr, nonce, providedSig] = parts;
  const payload = `${userId}.${issuedAtStr}.${nonce}`;
  const expectedSig = createHmac("sha256", secret).update(payload).digest("hex");
  const a = Buffer.from(providedSig, "hex");
  const b = Buffer.from(expectedSig, "hex");
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt)) return null;
  if (Date.now() - issuedAt > STATE_MAX_AGE_MS) return null;
  return { userId };
}

function errorRedirect(message: string): NextResponse {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://staffva.com";
  return NextResponse.redirect(
    `${baseUrl}/recruiter?google_error=${encodeURIComponent(message)}`
  );
}

function successRedirect(): NextResponse {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://staffva.com";
  return NextResponse.redirect(`${baseUrl}/recruiter?google_connected=1`);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const oauthError = req.nextUrl.searchParams.get("error");

  if (oauthError) return errorRedirect(oauthError);
  if (!code || !state) return errorRedirect("missing_code_or_state");

  const verified = verifyState(state);
  if (!verified) return errorRedirect("invalid_state");

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return errorRedirect("google_env_missing");
  }

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  let tokenData: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    tokenData = await tokenRes.json();
    if (!tokenRes.ok || tokenData.error) {
      return errorRedirect(tokenData.error || "token_exchange_failed");
    }
  } catch {
    return errorRedirect("token_exchange_network_error");
  }

  if (!tokenData.access_token) return errorRedirect("no_access_token");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const expiresIn = tokenData.expires_in ?? 3600;
  const tokenExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();

  const update: Record<string, unknown> = {
    google_access_token: tokenData.access_token,
    google_token_expiry: tokenExpiry,
    google_calendar_connected: true,
  };
  // Google only returns a refresh_token on first consent — keep the
  // existing one if this callback runs as a re-consent without it.
  if (tokenData.refresh_token) {
    update.google_refresh_token = tokenData.refresh_token;
  }

  const { error } = await admin
    .from("profiles")
    .update(update)
    .eq("id", verified.userId);
  if (error) return errorRedirect("db_update_failed");

  try {
    await createCalendarWatch(verified.userId);
  } catch (e) {
    console.error("[GOOGLE CALLBACK] Watch creation failed (non-blocking):", e);
  }

  return successRedirect();
}
