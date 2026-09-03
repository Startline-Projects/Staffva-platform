-- Broadened relist (owner's call, 2026-09-02, superseding the narrow 00149,
-- which becomes a no-op subset of this): back on the marketplace goes
-- everyone who EITHER passed the AI interview OR was live before the 00143
-- reset. That covers, beyond 00147's 21:
--
--   - the 9 remaining pre-reset passers (5 with complete profiles, 4 still
--     missing photo/resume/payout/recordings — the owner chose to list them
--     anyway; their cards fall back to the gradient block and fill in as
--     they finish their profiles),
--   - the 3 of those 9 who were ALSO live in April, before the went-live
--     stamp existed (proof: marketplace engagements, which have always
--     required approved status),
--   - and the 1 delisted-mid-engagement candidate who never passed the
--     interview but WAS live (same engagement proof; their client gets
--     their hired VA's profile back).
--
-- "Was live" is keyed on durable evidence: the went-live stamp where it
-- exists, else approval-gated engagement history. Candidates who were live
-- in the stamp-less era but were never hired leave no trace we can query;
-- if one surfaces, they will have to come back through the proctored funnel.
-- The went-live stamp backfills from the engagement evidence where we have
-- it; first-time listings stamp now().

update public.candidates c
   set admin_status = 'approved',
       profile_went_live_at = coalesce(
         c.profile_went_live_at,
         (select min(e.created_at) from public.engagements e
           where e.candidate_id = c.id and e.is_direct_contract = false),
         now()
       )
 where c.admin_status = 'active'
   and coalesce(c.permanently_blocked, false) = false
   and (
     c.ai_interview_passed is true
     or c.profile_went_live_at is not null
     or exists (select 1 from public.engagements e
                 where e.candidate_id = c.id and e.is_direct_contract = false)
   );
