-- 'failed_technical' has two very different causes writing to it:
--   1. the silence guard — we could not hear the candidate, a human must
--      look, and the candidate is waiting on us;
--   2. a stale abandoned session retired by the session routes so the
--      candidate can start fresh — nobody is waiting on anything.
--
-- The alert that watches for (1) counted both, so the "could not be heard"
-- warning would over-report every abandoned tab and lose its meaning.
alter table public.ai_interviews
  add column if not exists parked_reason text
    check (parked_reason in ('silent_answers', 'stale_abandoned'));

comment on column public.ai_interviews.parked_reason is
  'Why a failed_technical row was parked. silent_answers needs a human; stale_abandoned needs nobody.';
