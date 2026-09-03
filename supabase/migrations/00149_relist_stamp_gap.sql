-- 00147 keyed "was live before" on profile_went_live_at — but that column
-- only exists since 00041 (April 5) and nothing backfilled it, so the
-- April-era approvals carry no stamp. Adversarial review found three
-- candidates who satisfy the owner's relist rule on durable evidence
-- instead of the stamp:
--
--   they have ai_interview_passed = true (pre-reset scores 65 / 60 / 78),
--   and each was hired through /api/engagements/create, which has refused
--   non-approved candidates since the first commit — so an is_direct_contract
--   = false engagement is proof they were approved and live when it was
--   created. One of them still has an engagement in status 'active' whose
--   client lost sight of their hired VA when 00143 delisted everyone.
--
-- Relist those three, and stamp profile_went_live_at with the date of their
-- first marketplace engagement — the earliest moment they were provably
-- live (they went live somewhat before that; this is the conservative,
-- evidenced bound). The explicit id list is deliberate: the review verified
-- these rows one by one (complete profiles, ID verification passed, not
-- blocked), and no other row matches this evidence pattern.

update public.candidates c
   set admin_status = 'approved',
       profile_went_live_at = coalesce(
         c.profile_went_live_at,
         (select min(e.created_at) from public.engagements e
           where e.candidate_id = c.id and e.is_direct_contract = false)
       )
 where c.id in (
         'd00fff88-ac57-41cc-9d1d-d3bf15e10e7e',
         '96ef1ee4-a4b8-469c-8e15-a8b3a96b5ee2',
         'a8822240-435d-4271-935b-4fa36e2e2c65'
       )
   and c.ai_interview_passed is true
   and c.admin_status = 'active'
   and coalesce(c.permanently_blocked, false) = false;
