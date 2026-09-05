import { createClient } from "@/lib/supabase/server";
import { blockReasonFor, type ReviewState } from "@/lib/reviewEligibility";

/**
 * Every engagement the signed-in person is a party to, with the state of both
 * halves of its review pair.
 *
 * Uses the CALLER'S client, never the service role. my_review_state() is
 * SECURITY DEFINER but resolves auth.uid() itself, so under the service role
 * there is no uid and the function returns nothing — the safe direction, and
 * the reason the admin client that the rest of these pages use is absent here.
 */
export async function loadMyReviewState(): Promise<ReviewState[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_review_state");
  if (error) {
    // Deliberately soft. A review prompt is an invitation, not an obligation:
    // losing it costs the candidate nothing, while taking the dashboard down
    // over it would cost them the screen that carries their offers and
    // contracts. That is the opposite trade from loadCandidateWork(), which
    // throws — because a swallowed failure THERE renders as "you have no
    // offers", a false statement about something the person is owed.
    console.error("[reviewState] my_review_state failed:", error.message);
    return [];
  }
  return (data ?? []) as ReviewState[];
}

/** Engagements where this person can write a review right now. */
export function openReviews(states: ReviewState[]): ReviewState[] {
  return states.filter((s) => blockReasonFor(s) === null);
}
