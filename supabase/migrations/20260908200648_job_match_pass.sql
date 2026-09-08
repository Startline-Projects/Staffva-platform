-- 20260908200648_job_match_pass — let a client mark a match as "no" (client step 9).
--
-- Atlas's match-results screen has a Passed column in its pipeline strip and a
-- "Pass" button on every card. Neither does anything there: the button has no
-- handler and the Passed count is a hardcoded 0 in the HTML, which is the only
-- reason the two agree. This is the column that makes the control real.
--
-- Everything else on that pipeline strip is DERIVED and needs no storage:
--   contacted    — this row's invited_at, or a message between the pair
--   interviewing — an interview_bookings row (booked or completed)
--   offer        — an engagement_offers row, split on accepted
-- Only "passed" is a judgement the client makes and nothing else records.
--
-- NOTE: public.job_post_matches is not created by any migration in this repo —
-- it exists in the live database only, and 00192 already reaches it with a
-- bare `revoke ... from anon, authenticated` at top level. So this file does
-- NOT guard on the table existing: a guard here would be theatre, since a
-- database missing the table already fails at 00192, and swallowing the
-- absence would only move the failure to runtime, where every
-- GET /api/jobs/shortlist 500s on the missing column instead. Failing loudly
-- in the migration is the better of the two.
--
-- Writes go through /api/jobs/shortlist with the service role after an
-- ownership check on the JOB POST. No new grant is needed — 00192 already
-- revoked insert/update/delete from anon and authenticated, and that still
-- holds for this column.

alter table public.job_post_matches
  add column if not exists passed_at timestamptz;

-- The Passed tab filters on this on every render, always alongside the post.
create index if not exists idx_job_post_matches_passed
  on public.job_post_matches (job_post_id)
  where passed_at is not null;
