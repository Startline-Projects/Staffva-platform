-- STEP 9: the interview splits in two, per the Atlas plan.
--
-- Interview 1 (kind 'behavioral'): structured questions with prep/answer
-- timers — communication, problem-solving, judgment. Interview 2 (kind
-- 'skills'): the existing adaptive claims-probing exam. Every existing row
-- IS the skills exam, so the default backfills history correctly.
--
-- candidates.ai_interview_* keeps meaning THE SKILLS EXAM (Interview 2) —
-- every downstream gate (promote RPC, approvalGates, relist truth) reads it
-- and none of those change. Interview 1 gets its own columns.

alter table public.ai_interviews
  add column if not exists kind text not null default 'skills'
    check (kind in ('behavioral','skills')),
  add column if not exists question_plan jsonb;

comment on column public.ai_interviews.question_plan is
  'behavioral interviews: the served question ids + timing, so a resume replays the same plan.';

alter table public.interview_attempts
  add column if not exists kind text not null default 'skills'
    check (kind in ('behavioral','skills'));

alter table public.candidates
  add column if not exists interview1_passed boolean,
  add column if not exists interview1_score integer,
  add column if not exists interview1_completed_at timestamptz;

comment on column public.candidates.interview1_passed is
  'Interview 1 (behavioral) verdict. Candidates who passed the pre-split single interview (ai_interview_passed) are grandfathered — surfaces treat interview1 as done for them.';
