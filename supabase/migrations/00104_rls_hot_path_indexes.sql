-- Audit step 5 (RLS policy cost) — measured, not guessed.
--
-- THE HOT PATH. `select ... from candidates where user_id = auth.uid()` is the
-- candidate dashboard: it runs on every authenticated page load. It was a Seq
-- Scan, despite candidates_user_id_key being a UNIQUE index on exactly that
-- column.
--
-- Why: `candidates` carries three permissive SELECT policies, which Postgres ORs
-- together into one filter spanning three different columns —
--
--   assigned_recruiter = auth.uid()::text  OR  admin_status = 'approved'
--                                          OR  auth.uid() = user_id
--
-- A row can qualify through any branch, so no single index answers the question
-- and the planner falls back to scanning the table. It cannot BitmapOr the
-- branches together either, because `assigned_recruiter` had no index at all.
--
-- Measured on a 10,000-row copy of the table (the agreed target from step 1),
-- same query, as a real authenticated user:
--
--   today (3 policies, no assigned_recruiter index)  Seq Scan, 9,999 rows removed   74.98 ms
--   + index on assigned_recruiter                    BitmapOr across 3 indexes       2.43 ms
--   + also wrapping auth.uid() as (select auth.uid())                                1.71 ms
--
-- So the index alone is 31x, and it is the whole fix in practical terms. The
-- much-repeated "wrap auth.uid() in a select" advice is worth only a further
-- 1.4x here, and rewriting 53 policies to get it risks changing who can read
-- what. This migration therefore adds indexes ONLY and does not touch a single
-- policy. The wrapping is left as a separate, reversible change to be judged on
-- its own.
--
-- Note the remaining cost is bounded by the APPROVED count, not the total: the
-- admin_status branch matches every approved candidate (277 of 10,000 in the
-- test). At the step-1 conversion rate that is ~2.8% of signups, so this stays
-- cheap as the table grows.
create index if not exists idx_candidates_assigned_recruiter
  on public.candidates (assigned_recruiter);

-- UNINDEXED FOREIGN KEYS on the tables that scale with candidate volume.
--
-- 27 unindexed FKs exist; these are the ones the step-1 profile says actually
-- grow. Each is currently small enough that the planner scans it without
-- complaint, which is exactly why this has gone unnoticed — the pain arrives
-- with the volume, not before it.
--
-- Projected at 10,000 signups using the measured funnel (44.3% take the English
-- test, ~23 answers each):
--   candidate_test_answers    2,638 -> ~104,000
--   question_time_tracking    2,478 -> ~100,000
--   ai_interviews                56 -> ~2,210
--
-- candidate_test_answers and question_time_tracking are also the two tables
-- whose RLS policy is an EXISTS against candidates: without an index on
-- candidate_id, every policy check on them is a scan.
create index if not exists idx_test_answers_candidate
  on public.candidate_test_answers (candidate_id);
create index if not exists idx_test_answers_question
  on public.candidate_test_answers (question_id);
create index if not exists idx_question_time_candidate
  on public.question_time_tracking (candidate_id);

create index if not exists idx_ai_interviews_candidate
  on public.ai_interviews (candidate_id);
create index if not exists idx_interview_attempts_candidate
  on public.interview_attempts (candidate_id);
create index if not exists idx_interview_attempts_interview
  on public.interview_attempts (ai_interview_id);

-- Read on every test start, every profile render, and every recruiter queue poll.
create index if not exists idx_english_lockouts_candidate
  on public.english_test_lockouts (candidate_id);
create index if not exists idx_portfolio_items_candidate
  on public.portfolio_items (candidate_id);
create index if not exists idx_saved_candidates_candidate
  on public.saved_candidates (candidate_id);
create index if not exists idx_recruiter_notifications_candidate
  on public.recruiter_notifications (candidate_id);
create index if not exists idx_manager_notifications_candidate
  on public.manager_notifications (candidate_id);

-- Deliberately NOT indexed here: disputes, reviews, tenure_badges,
-- internal_messages, profile_revisions, recruiter_reassignment_log,
-- calendar_link_alerts, verified_identities, profile_edit_requests,
-- internal_thread_members. Those scale with engagements and staff actions
-- rather than with the signup spike, and an index that is never probed is
-- pure write cost.

analyze public.candidates;
analyze public.candidate_test_answers;
analyze public.question_time_tracking;
analyze public.ai_interviews;
