-- Find someone to run a candidate's second interview.
--
-- 29 of 56 candidates passed the AI interview. 27 of them had no second
-- interviewer assigned and no delegation email sent, and 0 second interviews
-- have ever been scored.
--
-- The cause is a vocabulary mismatch between two tables that were never
-- reconciled. interview/score/route.ts does:
--
--   .from("interviewer_delegation").eq("role_category", interview.role_category)
--
-- but the two columns speak different languages:
--
--   interviewer_delegation.role_category   12 GROUP names   "Support and Admin",
--                                                           "Development and Tech"
--   candidates.role_category               45 JOB TITLES    "Virtual Assistant",
--                                                           "Customer Support Representative"
--
-- They intersect on exactly one value, "Paralegal", and only by coincidence.
-- That is why precisely 2 candidates — the two Paralegals — were ever assigned
-- an interviewer, and why the other 27 were not.
--
-- Worse than a mismatch, it fails silently: the lookup uses .maybeSingle(), so
-- no match is `null` rather than an error, and the whole assign-and-email block
-- sits behind `if (delegation)`. No row, no assignment, no email, no log. The
-- candidate passes and simply waits forever.
--
-- Note that recruiter_assignments already speaks the right language: 61 job
-- titles, 42 of which match candidates.role_category, covering 251 of 254
-- candidates. Better still, candidates.assigned_recruiter is already populated
-- for 241 of 254 — including ALL 27 stranded candidates — and every one of
-- those resolves to a profile with an email. The information needed to route
-- these interviews has been there the whole time; nothing was reading it.
--
-- Resolution order, most specific first:
--   1. the recruiter already assigned to this candidate
--   2. interviewer_delegation, so the one case that works keeps working
--   3. any recruiter assigned this job title
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
    -- 1. The recruiter already handling this candidate. More precise than any
    --    category lookup: it names a person, not a bucket.
    select coalesce(p.full_name, 'Recruiter') as interviewer_name,
           p.email                            as interviewer_email,
           'assigned_recruiter'::text         as source,
           1                                  as pri
      from public.candidates c
      join public.profiles p on p.id::text = c.assigned_recruiter
     where c.id = p_candidate_id
       and p.email is not null
       and coalesce(p.is_active, true)

    union all

    -- 2. The original lookup, kept so the Paralegal case behaves exactly as it
    --    does today rather than being silently re-routed by this change.
    select d.interviewer_name,
           d.interviewer_email,
           'interviewer_delegation'::text,
           2
      from public.interviewer_delegation d
     where d.company_id = 'staffva'
       and d.role_category = p_role_category
       and d.interviewer_email is not null

    union all

    -- 3. Whoever owns this job title. The table that speaks the same vocabulary
    --    as candidates.role_category.
    select coalesce(p.full_name, 'Recruiter'),
           p.email,
           'recruiter_assignments'::text,
           3
      from public.recruiter_assignments r
      join public.profiles p on p.id = r.recruiter_id
     where r.role_category = p_role_category
       and p.email is not null
       and coalesce(p.is_active, true)
  ) x
  -- interviewer_email breaks ties deterministically, so the same candidate does
  -- not get routed to a different person on a retry.
  order by x.pri, x.interviewer_email
  limit 1;
$$;

revoke all on function public.resolve_second_interviewer(uuid, text) from public, anon;
grant execute on function public.resolve_second_interviewer(uuid, text) to authenticated, service_role;
