import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * Every review on the platform, in both directions, revealed or not.
 *
 * Reads the base table on purpose. The two published views —
 * `candidate_reviews_public` and `client_reviews_private` — are what the rest
 * of the product reads, and between them they hide exactly what a moderator
 * needs: unrevealed reviews, and taken-down ones.
 *
 * The asymmetry matters and the page says so. A review of a candidate goes on
 * a public profile and into a reputation score; a review of a client is
 * private to that client. Taking one down is not the same act as taking the
 * other down, so the direction is never just a label here.
 *
 * `published` defaults to true: a review is public the moment it reveals, and
 * this column is the only way back.
 *
 * Server-only: reads SUPABASE_SERVICE_ROLE_KEY.
 */

export type ReviewDirection = "client_to_candidate" | "candidate_to_client";

export interface AdminReview {
  id: string;
  engagementId: string;
  direction: ReviewDirection;
  rating: number;
  body: string | null;
  submittedAt: string;
  revealAt: string;
  published: boolean;
  candidateId: string | null;
  candidateName: string | null;
  clientId: string | null;
  clientName: string | null;
  /**
   * Whether the reveal time is still in the future, decided here rather than
   * in the view. Reading the clock during render is impure — the compiler is
   * right to object — and the same rule was already being applied twice.
   */
  sealed: boolean;
}

export interface ReviewsPage {
  reviews: AdminReview[];
  counts: { all: number; aboutCandidates: number; aboutClients: number; sealed: number; takenDown: number };
}

export type ReviewFilter = "all" | "about_candidates" | "about_clients" | "sealed" | "taken_down";

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function isReviewStaff(): Promise<boolean> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = user?.app_metadata?.role;
  return Boolean(user) && (role === "admin" || role === "recruiting_manager");
}

/** null means the read failed — never an empty platform. */
export async function loadReviews(): Promise<ReviewsPage | null> {
  if (!(await isReviewStaff())) return null;

  const db = serviceClient();
  const { data, error } = await db
    .from("reviews")
    .select("id, engagement_id, direction, rating, body, submitted_at, reveal_at, published, candidate_id, client_id")
    .order("submitted_at", { ascending: false });

  if (error) return null;

  const rows = data ?? [];
  const candidateIds = [...new Set(rows.map((r) => r.candidate_id).filter(Boolean))] as string[];
  const clientIds = [...new Set(rows.map((r) => r.client_id).filter(Boolean))] as string[];

  const [candidatesRes, clientsRes] = await Promise.all([
    candidateIds.length ? db.from("candidates").select("id, full_name, display_name").in("id", candidateIds) : Promise.resolve({ data: [] }),
    clientIds.length ? db.from("clients").select("id, full_name, company_name").in("id", clientIds) : Promise.resolve({ data: [] }),
  ]);

  const candidates = new Map((candidatesRes.data ?? []).map((c) => [c.id, c.full_name || c.display_name]));
  const clients = new Map((clientsRes.data ?? []).map((c) => [c.id, c.company_name || c.full_name]));

  const now = Date.now();
  const reviews: AdminReview[] = rows.map((r) => ({
    id: r.id,
    engagementId: r.engagement_id,
    direction: r.direction,
    rating: r.rating,
    body: r.body,
    submittedAt: r.submitted_at,
    revealAt: r.reveal_at,
    published: r.published,
    candidateId: r.candidate_id,
    candidateName: r.candidate_id ? (candidates.get(r.candidate_id) ?? null) : null,
    clientId: r.client_id,
    clientName: r.client_id ? (clients.get(r.client_id) ?? null) : null,
    sealed: new Date(r.reveal_at).getTime() > now,
  }));

  return {
    reviews,
    counts: {
      all: reviews.length,
      aboutCandidates: reviews.filter((r) => r.direction === "client_to_candidate").length,
      aboutClients: reviews.filter((r) => r.direction === "candidate_to_client").length,
      sealed: reviews.filter((r) => r.sealed).length,
      takenDown: reviews.filter((r) => !r.published).length,
    },
  };
}

export function applyReviewFilter(reviews: AdminReview[], filter: ReviewFilter): AdminReview[] {
  switch (filter) {
    case "about_candidates": return reviews.filter((r) => r.direction === "client_to_candidate");
    case "about_clients": return reviews.filter((r) => r.direction === "candidate_to_client");
    case "sealed": return reviews.filter((r) => r.sealed);
    case "taken_down": return reviews.filter((r) => !r.published);
    default: return reviews;
  }
}
