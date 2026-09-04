-- Grading open parts calls two paid vendors and increments non-idempotent
-- counters (retake_count, lockout rows), so exactly-one-grader must be a
-- database guarantee: the grader CLAIMS the attempt by moving it to
-- 'grading' in a single conditional UPDATE. Failed grading parks at
-- 'grading_failed', which the claim accepts again for retries.
alter table public.test_attempts drop constraint if exists test_attempts_status_check;
alter table public.test_attempts add constraint test_attempts_status_check
  check (status in ('created','submitted','grading','graded','grading_failed'));
