-- Let recruiters see the interviews they are responsible for.
--
-- The interview app's /recruiter dashboard reads ai_interviews through the
-- AUTHENTICATED client, not the service client that /dashboard/* uses. But
-- ai_interviews carried exactly two policies: full access for service_role, and
-- "the candidate may read their own". There was no recruiter policy at all, so
-- every recruiter's dashboard rendered zero rows.
--
-- Verified before writing this, reading as a real recruiter (Manar, who has
-- seven candidates assigned): 0 of 56 ai_interviews visible, and 1 of 324
-- profiles. The page was not broken in a way anyone would notice as an error —
-- it renders an empty table and an encouraging message about candidates
-- appearing once they finish their interview.
--
-- This matters now rather than eventually: 00106 just routed 29 passed
-- candidates to 8 recruiters, and every one of those recruiters would have
-- opened an empty dashboard.
--
-- The scope deliberately matches can_score_second_interview (00107/00108). A
-- recruiter who is allowed to SCORE an interview but not allowed to SEE it is
-- the same dead end one step earlier.
create policy recruiters_select_scoped_ai_interviews
on public.ai_interviews
for select
to authenticated
using (
  exists (
    select 1
      from public.profiles me
     where me.id = (select auth.uid())
       and (
         -- Admins and recruiting managers already see everything in the admin
         -- surfaces; this keeps the two consistent.
         me.role in ('admin', 'recruiting_manager')

         or (
           me.role = 'recruiter'
           and (
             -- Named as this interview's second interviewer.
             lower(ai_interviews.second_interviewer_email) = lower(me.email)

             -- Or responsible for the candidate behind it.
             or exists (
               select 1
                 from public.candidates c
                where c.id = ai_interviews.candidate_id
                  and (
                    c.assigned_recruiter = (select auth.uid())::text
                    or exists (
                      select 1
                        from public.recruiter_assignments r
                       where r.recruiter_id = (select auth.uid())
                         and r.role_category = c.role_category
                    )
                  )
             )
           )
         )
       )
  )
);

-- auth.uid() is wrapped as (select auth.uid()) so it evaluates once as an
-- InitPlan rather than per row. On its own that is worth little — measured at
-- roughly 1.4x in 00104 — but the supporting indexes for every branch already
-- exist (idx_ai_interviews_candidate, recruiter_assignments' unique
-- (recruiter_id, role_category), profiles' pkey), so the lookups here are seeks
-- rather than scans.
--
-- Note this is now a THIRD permissive SELECT policy on ai_interviews, and 00104
-- established that permissive policies OR together into one filter that can
-- defeat index use. It is acceptable here because the table is small — 56 rows
-- now, ~2,210 projected at the 10,000-candidate target — and every branch is
-- indexed. If ai_interviews ever grows past that, re-measure before adding a
-- fourth.

-- One behaviour worth writing down, found by testing rather than by reading.
--
-- The candidates subquery inside this policy is ITSELF subject to candidates'
-- RLS. So this policy can only reveal an interview whose candidate row the same
-- recruiter is already permitted to read. A recruiter who owns a role category
-- therefore still cannot see an interview whose candidate has no
-- assigned_recruiter, because candidates' own policy only exposes assigned or
-- approved rows.
--
-- Left as-is deliberately. The recruiter page inner-joins candidates, so such a
-- row could not render anyway, and 13 candidates are currently unassigned — none
-- of whom has passed an interview, so no pending work is hidden by it. If those
-- 13 ever matter, the fix belongs on candidates' policies, not here.
--
-- Measured after applying, reading as each real recruiter: Leyan 10 of 56,
-- Sam 4, and a candidate still sees exactly 1 (their own). Manar sees all 56
-- because she is a recruiting_manager, which is the intended branch — worth
-- noting because she was the first account tested and the full count initially
-- looked like the policy was too broad.
