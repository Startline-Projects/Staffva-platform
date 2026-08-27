-- The second interview has been removed. Move the candidates who were waiting
-- for one into approval, provided they meet every remaining requirement.
--
-- These 21 passed the AI interview and then sat at 'pending_2nd_interview'
-- waiting for a human call that will now never be scheduled. They cleared the
-- bar that existed when they applied.
--
-- Every one of the ten profile gates is re-checked here rather than assumed:
-- English scores, both voice recordings, ID verification, photo, resume,
-- tagline, bio, payout method and interview consent. Four other candidates in
-- the same waiting state are deliberately NOT included -- they never finished
-- Build Your Profile and are missing photo, resume, payout method and consent,
-- so approving them would put profiles on the public marketplace with no photo
-- and no identity trail.
--
-- No email is sent. There are no mail triggers on this table, and none should be
-- added for this: an AI proctor is coming for both the English test and the
-- interview, after which everyone re-takes both, so these approvals are
-- provisional and telling people about them now would be a message we have to
-- retract.
--
-- The pending_2nd_interview invariant trigger does not fire here: it returns
-- early unless NEW.admin_status IS 'pending_2nd_interview', and this moves rows
-- out of that state rather than into it.
update public.candidates c
   set admin_status = 'approved',
       profile_went_live_at = coalesce(profile_went_live_at, now())
 where c.admin_status::text = 'pending_2nd_interview'
   and exists (
     select 1 from public.ai_interviews i
      where i.candidate_id = c.id and i.status = 'completed' and i.passed
   )
   and c.english_mc_score >= 70
   and c.english_comprehension_score >= 70
   and c.voice_recording_1_url is not null
   and c.voice_recording_2_url is not null
   and c.id_verification_status = 'passed'
   and c.profile_photo_url is not null
   and c.resume_url is not null
   and c.tagline is not null
   and c.bio is not null
   and c.payout_method is not null
   and c.interview_consent_at is not null;
