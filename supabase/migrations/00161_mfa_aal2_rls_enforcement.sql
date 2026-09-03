-- TOTP MFA shipped (enroll at /account/security, challenge at /login,
-- middleware forces aal2 onto every page) but NO RLS policy inspected the
-- JWT aal claim — verified live before writing this: zero policies mention
-- aal. So an attacker holding a victim's password but not their TOTP could
-- call signInWithPassword, receive a perfectly valid aal1 access token, and
-- aim it straight at PostgREST (/rest/v1), where every own-row policy
-- happily matched: candidates profile fields, recording URLs, private
-- messages, financial rows — the entire surface the route/middleware AAL
-- gates were supposed to protect. Individual server routes (phone,
-- identity) were hardened earlier and 00159 locked the consent columns,
-- but the general PostgREST surface stayed open at aal1.
--
-- Fix per Supabase's documented pattern ("enforce rules based on MFA
-- enrollment status"): RESTRICTIVE policies that AND onto the existing
-- permissive set, gated by a helper that only bites when the user has a
-- verified factor. Users who never enrolled in MFA are completely
-- unaffected (helper returns true at aal1 for them); enrolled users must
-- present an aal2 token. Verified live at migration time: zero users
-- currently have a verified factor, so this binds nobody today — it takes
-- effect per-user at enrollment.
--
-- Scope, from a live audit of pg_policies:
--   * FOR ALL (reads AND writes) on the 14 tables whose SELECT policies
--     expose private own-row data an aal1 token could exfiltrate:
--     candidate profiles/recordings, client contact rows, both message
--     stores, AI-interview transcripts, bookings, attempts, and the
--     financial chain (orders, engagements, offers, milestones,
--     payment periods, disputes, change requests).
--   * Writes only (INSERT/UPDATE/DELETE) on the 19 remaining tables with
--     any authenticated/public write policy — including every admin
--     "manage" table from 00160, since staff accounts are exactly the
--     ones MFA most needs to protect. Their non-sensitive reads stay
--     open so nothing read-only breaks in a degraded aal1 state.
--   * Skipped: waitlist_users (anon-insertable by design — a gate on
--     authenticated adds nothing), service-role-only tables (RLS is
--     bypassed there), and public-read tables (packages, settings,
--     badges, question bank).
--
-- Legit flows keep working because the aal1-with-factor window only
-- exists mid-login: the /login challenge and enrollment both speak to
-- GoTrue (auth API), never PostgREST, and middleware bounces a pending
-- session off every page. After the TOTP verify the token is aal2 and
-- every gate passes.

-- SECURITY DEFINER so the auth.mfa_factors lookup runs as the function
-- owner (the auth schema is not readable by authenticated). Empty
-- search_path per the usual definer hygiene; everything inside is
-- schema-qualified. STABLE + the (select ...) wrapper at call sites make
-- it an InitPlan evaluated once per statement, not once per row — same
-- discipline as is_admin() in 00160.
create or replace function public.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    or not exists (
      select 1
        from auth.mfa_factors f
       where f.user_id = (select auth.uid())
         and f.status = 'verified'
    );
$$;

comment on function public.mfa_satisfied() is
  'True when the calling JWT is aal2, or when its user has no verified MFA factor (so non-enrolled users are unaffected). For RESTRICTIVE RLS policies; SECURITY DEFINER to read auth.mfa_factors.';

do $$
declare
  t text;
  gate_all text[] := array[
    'ai_interviews',
    'candidate_change_requests',
    'candidates',
    'clients',
    'disputes',
    'engagement_offers',
    'engagements',
    'interview_attempts',
    'interview_bookings',
    'messages',
    'milestones',
    'payment_periods',
    'recruiter_messages',
    'service_orders'
  ];
  gate_writes text[] := array[
    'application_progress',
    'availability_notifications',
    'candidate_availability',
    'candidate_availability_blackouts',
    'candidate_interviews',
    'candidate_test_answers',
    'capacity_log',
    'interview_requests',
    'job_post_matches',
    'job_posts',
    'portfolio_items',
    'profile_edit_requests',
    'profiles',
    'recruiter_assignments',
    'reviews',
    'saved_candidates',
    'screening_queue',
    'service_packages',
    'test_events'
  ];
begin
  foreach t in array gate_all loop
    execute format('drop policy if exists "MFA-enrolled must use aal2" on public.%I', t);
    execute format($p$
      create policy "MFA-enrolled must use aal2"
        on public.%I
        as restrictive
        for all
        to authenticated
        using ((select public.mfa_satisfied()))
        with check ((select public.mfa_satisfied()))
    $p$, t);
  end loop;

  foreach t in array gate_writes loop
    execute format('drop policy if exists "MFA-enrolled must use aal2 (insert)" on public.%I', t);
    execute format($p$
      create policy "MFA-enrolled must use aal2 (insert)"
        on public.%I
        as restrictive
        for insert
        to authenticated
        with check ((select public.mfa_satisfied()))
    $p$, t);

    execute format('drop policy if exists "MFA-enrolled must use aal2 (update)" on public.%I', t);
    execute format($p$
      create policy "MFA-enrolled must use aal2 (update)"
        on public.%I
        as restrictive
        for update
        to authenticated
        using ((select public.mfa_satisfied()))
    $p$, t);

    execute format('drop policy if exists "MFA-enrolled must use aal2 (delete)" on public.%I', t);
    execute format($p$
      create policy "MFA-enrolled must use aal2 (delete)"
        on public.%I
        as restrictive
        for delete
        to authenticated
        using ((select public.mfa_satisfied()))
    $p$, t);
  end loop;
end
$$;
