-- One appeal per rejection.
--
-- Deliberately columns on candidates rather than a table: an appeal is a
-- property of a decision, and a new table means new RLS, new grants and new
-- ways for a third party's or a reviewer's words to leak.
--
-- Atlas promises "a senior review from a DIFFERENT Talent Specialist" within
-- "5 business days". Neither ships. There are two admin accounts and one is a
-- test rig, so a different reviewer cannot be guaranteed; and no turnaround has
-- ever been met here, so promising one would be the same false claim this step
-- exists to remove. What ships is the part that is real: the candidate can say
-- why they think the decision was wrong, once, and a human answers in writing.

alter table public.candidates
  add column if not exists appeal_text         text,
  add column if not exists appeal_submitted_at timestamptz,
  add column if not exists appeal_decision     text
    check (appeal_decision is null or appeal_decision in ('upheld', 'overturned')),
  add column if not exists appeal_decided_at   timestamptz,
  add column if not exists appeal_decided_by   uuid references auth.users(id),
  add column if not exists appeal_response     text;

-- An appeal without a rejection is nonsense.
alter table public.candidates
  drop constraint if exists candidates_appeal_needs_a_rejection;
alter table public.candidates
  add constraint candidates_appeal_needs_a_rejection check (
    appeal_submitted_at is null or rejected_at is not null
  ) not valid;

-- A decided appeal must have been answered, by somebody, in words. The same
-- rule as the rejection itself: if it cannot be explained it cannot be
-- recorded.
alter table public.candidates
  drop constraint if exists candidates_appeal_decision_is_answered;
alter table public.candidates
  add constraint candidates_appeal_decision_is_answered check (
    appeal_decision is null
    or (
      appeal_decided_at is not null
      and appeal_decided_by is not null
      and appeal_response is not null
      and length(btrim(appeal_response)) >= 20
    )
  ) not valid;

comment on column public.candidates.appeal_text is
  'The candidate''s own words, capped at 1500 characters by the route, one per '
  'rejection. Cleared into a candidate_status_events row when a rejection is '
  'reinstated or overturned — which is what makes "one appeal per cycle" true '
  'in the code rather than only in the copy.';

-- No grants to `authenticated` here either. The appeal is posted through
-- /api/candidate/appeal under the service role, so the one-per-decision cap
-- and the status precondition are enforced server-side and the browser cannot
-- write its own appeal state.
