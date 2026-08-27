-- Drop the second-interview schema. The code that read every one of these
-- shipped and deployed first (interview app ec035d0, platform a99df54), and the
-- RLS policy referencing second_interviewer_email was rewritten in 00120.
-- Verified: no remaining policy, view, generated column or function depends on
-- anything dropped here.
--
-- What is destroyed, measured: 0 transcripts, 0 scores, 0 scored_at, 0 speaking
-- levels, 0 completions. 57 rows carried a second_interview_status of 'pending'
-- and 30 an assigned interviewer email. Not one second interview was ever
-- conducted, so no assessment record is lost.

-- 1. Functions. Both orphaned: their only callers were deleted routes.
drop function if exists public.resolve_second_interviewer(uuid, text);
drop function if exists public.can_score_second_interview(text, uuid);

-- 2. The invariant trigger guarding entry into 'pending_2nd_interview'. The
--    status has no holders and no writer, so the rule is vacuous.
drop trigger if exists enforce_pending_2nd_invariant_trg on public.candidates;
drop function if exists public.enforce_pending_2nd_invariant();

-- 3. ai_interviews: the scorecard the recruiter would have filled in, the routing
--    target, the blended first+second score, the speaking level, the prep guide.
alter table public.ai_interviews
  drop column if exists second_interview_status,
  drop column if exists second_interview_transcript,
  drop column if exists second_interview_scored_at,
  drop column if exists second_interview_overall,
  drop column if exists second_interview_technical,
  drop column if exists second_interview_problem,
  drop column if exists second_interview_communication,
  drop column if exists second_interview_experience,
  drop column if exists second_interview_professionalism,
  drop column if exists second_interview_feedback,
  drop column if exists second_interview_ai_notes,
  drop column if exists second_interview_recruiter_email,
  drop column if exists second_interview_recruiter_name,
  drop column if exists second_interviewer_assigned,
  drop column if exists second_interviewer_email,
  drop column if exists advanced_to_second_interview,
  drop column if exists speaking_level,
  drop column if exists pre_interview_guide,
  drop column if exists pre_interview_guide_generated_at,
  drop column if exists combined_score,
  drop column if exists combined_recommendation,
  drop column if exists combined_recommendation_reason;

-- 4. candidates: scheduling state and the Google Calendar event handle.
--    waiting_since is deliberately KEPT -- read by the recruiter queue and the
--    admin triage page, and not second-interview specific.
alter table public.candidates
  drop column if exists second_interview_status,
  drop column if exists second_interview_scheduled_at,
  drop column if exists second_interview_completed_at,
  drop column if exists google_calendar_event_id;

-- 5. profiles: the recruiter's Google OAuth grant and booking link.
--    NOTE: dropping the token columns does NOT revoke anything at Google. Three
--    accounts held live refresh tokens and active push channels; those must be
--    revoked separately or StaffVA's OAuth client keeps calendar.readonly access.
alter table public.profiles
  drop column if exists google_access_token,
  drop column if exists google_refresh_token,
  drop column if exists google_token_expiry,
  drop column if exists google_calendar_id,
  drop column if exists google_calendar_connected,
  drop column if exists google_watch_channel_id,
  drop column if exists google_watch_expiry,
  drop column if exists calendar_link,
  drop column if exists calendar_link_last_set_at,
  drop column if exists calendar_link_cleared_at;

-- 6. The calendar booking tables. calendar_unmatched_bookings held 753 rows of
--    triage history from April/May, 250 carrying an attendee_email for someone
--    who booked a recruiter's public appointment page and was never matched.
--    Nothing can read it any more, it records a feature that no longer exists,
--    and holding third-party PII with no purpose is a liability, not an asset.
drop table if exists public.calendar_unmatched_bookings;
drop table if exists public.calendar_link_alerts;
