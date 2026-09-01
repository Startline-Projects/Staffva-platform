-- P3: the consent copy promises flagged evidence is kept "until a decision
-- is made and for 7 days after". decided_at is the decision stamp (set when
-- a human resolves a flagged session to cleared_by_human or
-- confirmed_cheating); the review cron's retention sweep deletes the
-- footage 7 days later, making the promise enforced rather than aspirational.
alter table public.proctor_sessions
  add column if not exists decided_at timestamptz;
