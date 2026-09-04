-- Step-8 review fixes (database half).

-- 1. The grading lease. A crash between the grading claim and either
--    terminal write left the attempt at status='grading' forever — no
--    retry could claim it, no cron watched it, the candidate's only exit
--    was silently redoing the whole proctored test. The claim now records
--    WHEN grading started, and re-accepts 'grading' rows older than the
--    lease (the reclaim lives in lib/gradeAttempt).
alter table public.test_attempts
  add column if not exists grading_started_at timestamptz;

-- 2. 'expired' — the terminal state for attempts that came back after the
--    deadline. Without it, a late submit was refused with a 410 but left
--    sitting at 'submitted', and one POST /api/test/grade graded it anyway:
--    hold the attempt open all night, look everything up, submit late, eat
--    the 410, call the grade route, collect a pass. Also used for stale
--    attempts superseded by a newer submission.
alter table public.test_attempts drop constraint if exists test_attempts_status_check;
alter table public.test_attempts add constraint test_attempts_status_check
  check (status in ('created','submitted','grading','graded','grading_failed','expired'));

-- 3. Storage lockdown. The voice-recordings policies from 00001 allow ANY
--    authenticated user to read and write EVERYTHING in the bucket — which
--    now includes assessment answer recordings and the listening prompt
--    audio (the unheard question, fetchable before the test). Profile
--    voice-intro behavior is preserved; the assessment paths become
--    service-role-only (the app reaches them via signed URLs and API
--    routes, never direct storage access).
drop policy if exists "Candidates can upload voice recordings" on storage.objects;
create policy "Candidates can upload voice recordings"
  on storage.objects for insert
  with check (
    bucket_id = 'voice-recordings'
    and auth.role() = 'authenticated'
    and name not like '%/assessment/%'
    and name not like 'assessment-prompts/%'
  );

drop policy if exists "Authenticated users can read voice recordings" on storage.objects;
create policy "Authenticated users can read voice recordings"
  on storage.objects for select
  using (
    bucket_id = 'voice-recordings'
    and auth.role() = 'authenticated'
    and name not like '%/assessment/%'
    and name not like 'assessment-prompts/%'
  );

-- 4. Speaking prompts claimed "You have 60 seconds" while the visible
--    timer counts 70 (10s think time). The timer is the truth — the
--    sentence goes.
update public.english_test_questions
  set question_text = trim(replace(question_text, 'You have 60 seconds.', ''))
  where section = 'speaking';
