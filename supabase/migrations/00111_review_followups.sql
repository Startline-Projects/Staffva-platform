-- Three follow-ups from an adversarial review of the same day's work.
-- Every one of these is a defect in code shipped earlier today.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Do not route an interview to someone who cannot open the app.
--
-- resolve_second_interviewer (00106) branch 1 resolves whoever
-- candidates.assigned_recruiter points at, filtered only on
-- `p.email is not null and coalesce(p.is_active, true)`. It never asks whether
-- that person can actually DO anything with the assignment.
--
-- Three different sources of truth for "is this a recruiter" are in play:
--   00106            no role check at all
--   00109's policy   profiles.role
--   interview app    auth.users.raw_app_meta_data->>'interview_role'
--                    (staffva-interview-main, src/lib/auth/get-session-user.ts)
--
-- Leyan (ops@glostaffing.com) has profiles.role = 'recruiter', is_active, and 50
-- assigned candidates — but NO interview_role, so she cannot sign in to the
-- interview app where second interviews are conducted. Today's backfill made her
-- the second_interviewer_email on 7 of the 29 passed interviews, the joint
-- largest share. Routing "fixed" those candidates into a different dead end.
--
-- The predicate below is the interview app's own gate, so the resolver can only
-- pick someone who can actually act on the assignment. Reading auth.users is
-- deliberate rather than reading profiles.role: profiles.role is what a person
-- IS, interview_role is what they can OPEN, and this function's whole job is to
-- pick someone who can do the work.
create or replace function public.resolve_second_interviewer(
  p_candidate_id uuid,
  p_role_category text
)
returns table (interviewer_name text, interviewer_email text, source text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select x.interviewer_name, x.interviewer_email, x.source
  from (
    select coalesce(p.full_name, 'Recruiter') as interviewer_name,
           p.email                            as interviewer_email,
           'assigned_recruiter'::text         as source,
           1                                  as pri
      from public.candidates c
      join public.profiles p on p.id::text = c.assigned_recruiter
      join auth.users u on u.id = p.id
     where c.id = p_candidate_id
       and p.email is not null
       and coalesce(p.is_active, true)
       and u.raw_app_meta_data->>'interview_role' is not null

    union all

    select d.interviewer_name,
           d.interviewer_email,
           'interviewer_delegation'::text,
           2
      from public.interviewer_delegation d
     where d.company_id = 'staffva'
       and d.role_category = p_role_category
       and d.interviewer_email is not null

    union all

    select coalesce(p.full_name, 'Recruiter'),
           p.email,
           'recruiter_assignments'::text,
           3
      from public.recruiter_assignments r
      join public.profiles p on p.id = r.recruiter_id
      join auth.users u on u.id = p.id
     where r.role_category = p_role_category
       and p.email is not null
       and coalesce(p.is_active, true)
       and u.raw_app_meta_data->>'interview_role' is not null
  ) x
  order by x.pri, x.interviewer_email
  limit 1;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Take back the EXECUTE grants that buy nothing.
--
-- Both functions were granted to `authenticated`, but every call site uses the
-- SERVICE client (interview app: score/route.ts and score-second-interview/
-- route.ts). The grant is pure attack surface: both are SECURITY DEFINER, so
-- they bypass profiles' RLS, and both take the identity as an ARGUMENT rather
-- than reading auth.uid() — so any signed-in candidate could call them through
-- PostgREST with values of their choosing.
--
-- Demonstrated on this database: resolve_second_interviewer with a nonexistent
-- candidate UUID still answers from branch 3, so walking the 61 role_category
-- values enumerates every staff name and address. Passing a REAL candidate id
-- discloses which recruiter is assigned to that specific person.
--
-- can_score_second_interview is an oracle rather than an escalation — it returns
-- a boolean and grants nothing, and score-second-interview independently
-- requires an admin/recruiter interview_role before it is ever reached — but it
-- still lets an authenticated caller probe who may score whom.
--
-- If a browser-side caller is ever genuinely needed, derive the identity from
-- auth.uid() INSIDE the function rather than accepting it as an argument.
revoke execute on function public.resolve_second_interviewer(uuid, text) from authenticated;
revoke execute on function public.can_score_second_interview(text, uuid) from authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Requeue the newest message, not the newest FAILED one.
--
-- 00110 selects `distinct on (to_email) ... where status = 'failed'`, which
-- picks the newest row AMONG THE FAILED ones and never looks at any other
-- status. Its stated correctness argument is that only the newest message per
-- address carries a token that still verifies — but that argument only holds if
-- no LATER message went out.
--
-- The sequence that breaks it: a verification fails at T0; the candidate clicks
-- resend at T1, which overwrites profiles.email_verification_token and sends
-- successfully. An operator then runs the requeue. The T0 row is still the
-- newest FAILED row, so it is delivered — arriving after the working one, at the
-- top of the inbox, carrying a token that no longer matches.
--
-- Clicking it writes nothing (verify-email returns at its null-profile branch),
-- so no account is damaged. But the recovery tool would be handing a known-dead
-- link to someone who already had a live one.
create or replace function public.requeue_failed_emails(
  p_since_hours integer default 24,
  p_email_type text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  with newest as (
    select distinct on (o.to_email) o.id
      from public.email_outbox o
     where o.status = 'failed'
       and o.created_at > now() - make_interval(hours => p_since_hours)
       and (p_email_type is null or o.email_type = p_email_type)
       -- Skip any address whose later message already went out. That message
       -- holds the live token; resending an older one only adds a dead link.
       and not exists (
         select 1
           from public.email_outbox n
          where n.to_email = o.to_email
            and n.email_type = o.email_type
            and n.created_at > o.created_at
            and n.status <> 'failed'
       )
     order by o.to_email, o.created_at desc
  )
  update public.email_outbox o
     set status          = 'pending',
         attempts        = 0,
         next_attempt_at = now(),
         claimed_at      = null,
         last_error      = null
    from newest n
   where o.id = n.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.requeue_failed_emails(integer, text) from public, anon, authenticated;
grant execute on function public.requeue_failed_emails(integer, text) to service_role;
