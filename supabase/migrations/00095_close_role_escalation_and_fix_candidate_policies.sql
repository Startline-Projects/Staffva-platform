-- == 1. Stop users promoting themselves to admin.
--
-- RLS is row-level: "Users can update own profile" USING (auth.uid() = id)
-- controls WHICH ROW may be updated and can never control WHICH COLUMN. Both
-- anon and authenticated held Supabase's default table-level GRANT ALL on
-- public.profiles, so any signed-in user could set their own role to 'admin'
-- -- and 27 API routes still authorise off profiles.role. They could also set
-- their own email_verified, skipping email verification entirely.
--
-- Unreachable while signup was closed; reopening is exactly what makes it
-- exploitable, which is why this lands before the doors open.
--
-- Note: a column-level `revoke update (role)` does NOT work here. A
-- column-level revoke cannot subtract from a table-level grant, so the
-- privilege has to be removed at the table level.
--
-- Safe to remove outright: every write to profiles in the codebase goes
-- through the service_role admin client (auth/verify-email,
-- auth/resend-verification, recruiter/calendar-link, recruiter/photo,
-- recruiter/google/callback, admin/recruiter-photo, lib/google-calendar), and
-- service_role bypasses these grants. No browser-scoped path updates
-- profiles, so nothing legitimate loses access. SELECT is untouched.
revoke update on public.profiles from anon, authenticated;

-- == 2. Fix policies that compare candidate_id to auth.uid().
--
-- interview_attempts.candidate_id and ai_interviews.candidate_id hold
-- candidates.id, never the auth user id. Verified against production: 0 of
-- 253 candidates have id = user_id, and 71 of 71 interview_attempts rows
-- join to candidates.id while 0 join to auth.users.id. These policies
-- therefore matched no row for any candidate, ever.
--
-- Effect: the candidate dashboard reads interview_attempts with the
-- RLS-bound browser client, so retakeData was always null and the retake
-- button never rendered. 19 candidates sit in ai_interview_failed with no
-- way forward.
drop policy if exists "Candidates can view own attempts" on public.interview_attempts;

create policy "Candidates can view own attempts"
  on public.interview_attempts
  for select
  using (
    candidate_id in (select id from public.candidates where user_id = auth.uid())
  );

-- On ai_interviews the same broken policy is redundant rather than harmful:
-- candidates_select_own_ai_interviews already grants this access by joining
-- through candidates, and OR'd policies masked the bug. Drop the broken one
-- instead of keeping two policies for one rule.
drop policy if exists "Candidates can view own interviews" on public.ai_interviews;
