-- "Did not answer" is now a real, recorded outcome: grading runs over the
-- SERVED set, so a skipped question produces a row with selected_answer NULL
-- and is_correct false — previously unanswerable, because only answered
-- questions ever reached this table.
alter table public.candidate_test_answers
  alter column selected_answer drop not null;
