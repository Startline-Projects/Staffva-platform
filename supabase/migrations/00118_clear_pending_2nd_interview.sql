-- Empty the phantom state.
--
-- 00115 approved the 21 waiting candidates who met every requirement. These 4
-- did not: they passed the interview but never finished Build Your Profile, and
-- are missing photo, resume, payout method and consent.
--
-- Leaving them in 'pending_2nd_interview' is not neutral. That status tells them
-- on their status screen that a second interview "will be scheduled soon" -- a
-- promise nobody will keep, and one that reads as "wait" when the truth is that
-- the ball is in their court. 'active' is the state for a candidate still
-- working through the funnel, and it says so: "Complete your next steps to move
-- forward."
--
-- Nothing is lost by the move. Their passed interview lives in ai_interviews,
-- not in this column, and promote_candidate_if_ready (00116) covers 'active'
-- exactly as it covered 'pending_2nd_interview' -- so the moment any of them
-- finishes their profile they go live automatically.
--
-- After this the status has no holders and nothing writes it. It is left in the
-- enum rather than dropped, because dropping an enum value used by historical
-- rows and by the 00084 invariant trigger is a separate, riskier change.
update public.candidates
   set admin_status = 'active'
 where admin_status::text = 'pending_2nd_interview';
