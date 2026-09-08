-- 00220: an optional assessment must never cost someone their listing.
--
-- `permanently_blocked` does two unrelated jobs today. It means "no more test
-- attempts" (read by /api/test/questions and the assessment page) AND "not in
-- the marketplace" — migration 00188 puts a trigger on it that flips
-- approved -> deactivated, and every browse/visibility predicate filters it.
--
-- The English grader writes it (src/lib/gradeAttempt.ts) after the retake
-- ladder is exhausted. Under the model where assessments are OPTIONAL, that
-- is a trap: a listed candidate takes a voluntary test, fails it enough
-- times, and is silently removed from the marketplace by something they were
-- told was a bonus. The /apply route already documents this exact footgun as
-- the reason it refuses to link approved candidates into the test flow.
--
-- So the two meanings get two columns. This one carries the test-eligibility
-- half; `permanently_blocked` keeps the listing half and from here on is only
-- ever set by a person (staff/fraud action), never by a grader.
--
-- Zero rows affected at write time: probed live 2026-09-08 — 0 candidates
-- permanently_blocked, 0 english_test_lockouts rows, 0 with retake_count >= 5.
-- Nobody is mid-ladder, so there is nothing to migrate across.
alter table public.candidates
  add column if not exists english_attempts_exhausted boolean not null default false;

comment on column public.candidates.english_attempts_exhausted is
  'The English retake ladder is spent: no further attempts. Deliberately NOT '
  'permanently_blocked — that column delists a candidate from the marketplace '
  'via the 00188 trigger, and an optional assessment must never do that.';

-- No grant to authenticated: candidates.* is column-granted (00120) and this
-- is written server-side by the grader only.
