-- 00198 — the reviewer's first name on the public view, and nothing more.
--
-- Two readers still queried public.reviews directly with .eq("candidate_id"),
-- both on the SERVICE ROLE, which bypasses RLS entirely:
--   src/app/candidate/[id]/page.tsx:307   — the public candidate profile
--   src/app/api/candidates/preview:43,53  — the browse preview panel
--
-- Once any review existed, both would have shown unrevealed reviews to the
-- world, and both would have rendered the candidate's OWN outbound review of
-- their client as a review of the candidate — averaging it into the star
-- rating — because the two halves of a pair share a candidate_id. That is the
-- exact trap 00196 split the views to prevent, and the migration did not finish
-- the job: it created the safe view without moving every reader onto it.
--
-- The preview panel prints the reviewer's FIRST name as a byline, so the view
-- has to carry it. First name only, from split_part — the client's surname is
-- not part of a public byline, and the panel never rendered it anyway.

drop view if exists public.candidate_reviews_public;

create view public.candidate_reviews_public with (security_invoker = on) as
  select r.id, r.engagement_id, r.candidate_id, r.rating, r.body, r.submitted_at,
         nullif(split_part(coalesce(cl.full_name, ''), ' ', 1), '') as client_first_name
    from public.reviews r
    left join public.clients cl on cl.id = r.client_id
   where r.published and r.direction = 'client_to_candidate'
     and public.review_is_revealed(r);

grant select on public.candidate_reviews_public to anon, authenticated;
