import { SignJWT } from "jose";

/**
 * Mint the token a candidate carries into the interview app.
 *
 * THE EXPIRY IS COUPLED TO THE INTERVIEW APP'S RESUME WINDOW. That app will
 * resume an in-progress interview for STALE_AFTER_HOURS = 6
 * (staffva-interview-main, src/app/api/interview/session/route.ts), so a token
 * that dies sooner promises a resume the candidate cannot actually perform.
 *
 * It was 1h against that 6h window. A candidate who stepped away and came back
 * inside the documented window — the exact case the resume logic exists for —
 * arrived with a dead token, and every route in the interview app verifies it.
 *
 * 8h, not 6h, because the clock starts at MINT and the resume window is
 * measured from the interview's created_at. Someone can be handed a token and
 * start twenty minutes later; the margin covers that gap rather than leaving the
 * two to meet exactly and fail at the boundary.
 *
 * Note the interview app mints its own tokens at 24h (its
 * lib/auth/verify-token.ts) — the two mints have never agreed. If either number
 * moves, move it against the resume window, not against the other mint.
 */
const EXPIRY = "8h";

export async function generateInterviewToken(candidateId: string): Promise<string> {
  const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);
  return new SignJWT({ candidate_id: candidateId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(candidateId)
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(secret);
}
