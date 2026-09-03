-- Nine "Admin can manage ..." policies were FOR ALL TO public USING (true):
-- written assuming "admin" but gating nothing, so any holder of the public
-- anon key could UPDATE every row (and pass INSERT's WITH CHECK) on all nine
-- tables via PostgREST. 00159 already killed the DELETE arm by revoking the
-- grant; this closes the UPDATE/INSERT half by giving each policy a real
-- admin qual. Verified before writing this: no app code reaches these nine
-- tables with a user client for writes (admin/recruiter API routes all use
-- the service-role client, which bypasses RLS), and every legitimate
-- non-admin path has its own scoped policy (clients/candidates own-row
-- policies, public_read_service_packages), so nothing depends on the
-- USING (true) arms.
--
-- "Admin" means profiles.role admin or recruiting_manager — the same
-- all-access staff tier 00120 established for ai_interviews reads.

-- SECURITY DEFINER so the profiles lookup runs as the function owner:
-- the table owner bypasses profiles RLS (row security is not FORCEd),
-- keeping this check independent of profiles' own policy set and immune
-- to policy recursion. Empty search_path per the usual definer hygiene;
-- everything inside is schema-qualified.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = (select auth.uid())
       and p.role = any (array['admin'::public.user_role_type,
                               'recruiting_manager'::public.user_role_type])
  );
$$;

comment on function public.is_admin() is
  'True when the calling JWT belongs to a profiles row with role admin or recruiting_manager. For RLS quals; SECURITY DEFINER to dodge profiles RLS recursion.';

-- Each policy keeps its historical name (drop/create, not rename) and
-- narrows TO authenticated — anon can never be admin, so anon requests
-- skip these policies entirely. The (select ...) wrapper makes the check
-- an InitPlan evaluated once per statement, not once per row.

drop policy "Admin can manage all notifications" on public.availability_notifications;
create policy "Admin can manage all notifications"
  on public.availability_notifications
  for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy "Admins can manage interviews" on public.candidate_interviews;
create policy "Admins can manage interviews"
  on public.candidate_interviews
  for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy "Admin can manage capacity log" on public.capacity_log;
create policy "Admin can manage capacity log"
  on public.capacity_log
  for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy "Admins can manage interview requests" on public.interview_requests;
create policy "Admins can manage interview requests"
  on public.interview_requests
  for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy "Admin can manage all matches" on public.job_post_matches;
create policy "Admin can manage all matches"
  on public.job_post_matches
  for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy "Admin can manage all job posts" on public.job_posts;
create policy "Admin can manage all job posts"
  on public.job_posts
  for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy "Admin can manage all assignments" on public.recruiter_assignments;
create policy "Admin can manage all assignments"
  on public.recruiter_assignments
  for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy "Admin can manage all orders" on public.service_orders;
create policy "Admin can manage all orders"
  on public.service_orders
  for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy "Admin can manage all packages" on public.service_packages;
create policy "Admin can manage all packages"
  on public.service_packages
  for all
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
