-- RELIST (owner's call, 2026-09-02): the 00143 re-verification reset delisted
-- every approved candidate until they re-pass under proctoring. The owner is
-- reversing that for the candidates who had PASSED the AI interview before the
-- reset and were live: they go back on the marketplace now, without waiting
-- for the proctored retake.
--
-- The marker set: 00143 nulled the English scores and interview completion
-- stamps but never touched candidates.ai_interview_passed or
-- profile_went_live_at — so "passed before AND was live before" is exactly
-- this pair. Measured before running: 21 candidates, all with photo, tagline,
-- bio and skills; none permanently blocked.
--
-- Deliberately NOT restored: the 9 who passed the interview but never went
-- live (5 have complete profiles, 4 do not) — going live for the first time
-- is a different decision from coming back. Their path stays the normal one:
-- proctored retake, then promote_candidate_if_ready.
--
-- profile_went_live_at keeps its original date — this is a return, not a new
-- launch. A raw UPDATE sends no emails; nothing demotes automatically (the
-- promote function and crons only ever promote), and a future failed
-- proctored retake still sets ai_interview_failed as usual.

update public.candidates
   set admin_status = 'approved'
 where ai_interview_passed is true
   and profile_went_live_at is not null
   and admin_status = 'active'
   and coalesce(permanently_blocked, false) = false;
