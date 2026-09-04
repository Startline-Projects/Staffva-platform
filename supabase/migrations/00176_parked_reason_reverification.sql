-- Name the 52 rows that 00143 parked, so they stop reading as an audio backlog.
--
-- 00143_reverification_reset.sql did this:
--
--     update public.ai_interviews
--        set status = 'failed_technical', passed = false
--      where status = 'completed';
--
-- Every one of those 52 rows is SCORED — overall_score still runs 30 to 78 —
-- so they are not technical failures in any sense. They were valid interviews
-- invalidated on purpose, because the marketplace decided to re-qualify
-- everybody. But 'failed_technical' with a NULL parked_reason is exactly the
-- shape the health alert reads as "the candidate could not be heard, so they
-- were not scored", each one needing a human decision or a re-invite.
--
-- They are outside the alert's 7-day window today, which is the only reason
-- nothing is firing. That is luck, not design: widen the window, re-run a
-- backfill, or reset another cohort, and 52 phantom candidates appear in a
-- queue that is supposed to mean somebody is stuck waiting on us.
--
-- 00173 split this column precisely so the "could not be heard" warning would
-- stop drowning in tab-closes. This finishes that job for the third population
-- it was always going to have.

alter table public.ai_interviews
  drop constraint if exists ai_interviews_parked_reason_check;

alter table public.ai_interviews
  add constraint ai_interviews_parked_reason_check
  check (parked_reason is null
         or parked_reason in ('silent_answers', 'stale_abandoned', 'reverification_reset'));

-- What actually makes this safe is `parked_reason is null`, not the score.
--
-- An earlier version of this comment claimed a genuine silence park is never
-- scored. That is wrong, and the review caught it: score/route.ts computes and
-- WRITES the scorecard first, then parks the row — the silence guard withholds
-- the adverse action, it does not skip the scoring. So "parked and scored" is
-- the signature of BOTH populations, and the score tells them apart not at all.
--
-- The discriminator is the NULL. Every writer of failed_technical has stamped a
-- parked_reason in the same UPDATE since 00173 — score/route.ts and iv1Score.ts
-- write silent_answers, both session routes write stale_abandoned — so a NULL
-- here can only be a row parked before 00173 existed, and the only such rows
-- are 00143's. The `overall_score is not null` clause stays as a second lock,
-- not as the argument.
update public.ai_interviews
   set parked_reason = 'reverification_reset'
 where status = 'failed_technical'
   and parked_reason is null
   and overall_score is not null;

comment on column public.ai_interviews.parked_reason is
  'Why a failed_technical row was parked. silent_answers needs a human; '
  'stale_abandoned needs nobody; reverification_reset is a valid interview that '
  '00143 invalidated on purpose and also needs nobody. NULL now means only a '
  'park written before 00173 that was never classified.';
