-- Migration 00092 — add_uniqueness_constraints_for_races
--
-- Several flows enforce "only one of these may exist" purely in application
-- code (SELECT, then INSERT if nothing found). Two concurrent requests both
-- see nothing and both insert. These indexes move the invariant into the
-- database, where it holds regardless of interleaving; the app-level check
-- remains as the friendly fast path. Applied live.
--
-- Verified zero existing duplicates for each target before applying.
-- candidate_emails is deliberately NOT constrained: it already contains 12
-- duplicate rows produced by the .single() idempotency bug, and de-duplicating
-- would destroy send history. That one is fixed in application code instead
-- (limit(1).maybeSingle(), so the guard works despite existing duplicates).

-- One review per client per engagement
create unique index if not exists reviews_engagement_client_key
  on public.reviews (engagement_id, client_id);

-- One contract per engagement
create unique index if not exists engagement_contracts_engagement_key
  on public.engagement_contracts (engagement_id);

-- Only one PENDING edit request per candidate per field (resolved/declined
-- rows may legitimately repeat, so this is a partial index)
create unique index if not exists profile_edit_requests_pending_key
  on public.profile_edit_requests (candidate_id, field_name)
  where status = 'pending';

-- One interview row per candidate per interview number
create unique index if not exists candidate_interviews_candidate_number_key
  on public.candidate_interviews (candidate_id, interview_number);
