-- RE-VERIFICATION (owner's call, 2026-09-01): every English test and AI
-- interview taken before proctored assessments went live is invalidated.
-- All candidates redo both under the current monitored system; approved
-- candidates come OFF the marketplace until they re-pass (owner chose
-- delist-now over a grace window). promote_candidate_if_ready re-approves
-- automatically on a fresh pass — no manual step.

-- 1. Old interviews stop counting as passed. Without this, the hourly
--    promote-ready sweep would re-approve every delisted candidate from
--    their unproctored pass within the hour. failed_technical is the
--    existing "not scored, retake available" state.
update public.ai_interviews
   set status = 'failed_technical', passed = false
 where status = 'completed';

-- 2. English test reset (the test writes all five columns, tier included).
update public.candidates
   set english_mc_score = null,
       english_comprehension_score = null,
       english_percentile = null,
       english_written_tier = null,
       test_completed_at = null,
       test_started_at = null,
       test_time_remaining_seconds = null
 where test_completed_at is not null or english_mc_score is not null;

-- 3. Interview completion reset.
update public.candidates
   set ai_interview_completed_at = null,
       ai_interview_score = null
 where ai_interview_completed_at is not null or ai_interview_score is not null;

-- 4. Delist the approved; release the fail-gate to a fresh start — their
--    unproctored fail is as invalid as everyone else's unproctored pass.
update public.candidates
   set admin_status = 'active'
 where admin_status in ('approved', 'ai_interview_failed');

-- 5. No retake locks or stale notification stamps from the old era.
update public.interview_attempts
   set next_retake_available_at = null
 where next_retake_available_at is not null;

update public.candidates
   set ai_interview_retake_notified_at = null
 where ai_interview_retake_notified_at is not null;
