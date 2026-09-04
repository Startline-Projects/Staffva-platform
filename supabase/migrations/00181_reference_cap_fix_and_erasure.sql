-- Two corrections to 00179, both found by review.

-- 1. The cap trigger counted siblings by excluding new.id, which is wrong on
--    the path the app actually uses. The API upserts with onConflict
--    (candidate_id, employer_key) and supplies no id, so an UPDATE of an
--    existing reference reaches the BEFORE INSERT trigger carrying a freshly
--    defaulted id — and the row being replaced counted against the cap. A
--    candidate holding five references could not edit any of them, and since
--    the exception surfaced inside profile submit, the whole submit died.
--
--    Identity here is (candidate_id, employer_key), the same pair the unique
--    constraint uses, not the surrogate key.
create or replace function public.candidate_references_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  select count(*) into n
    from public.candidate_references r
   where r.candidate_id = new.candidate_id
     and r.employer_key is distinct from new.employer_key;
  if n >= 5 then
    raise exception 'A candidate may hold at most 5 references';
  end if;
  return new;
end;
$$;

-- 2. 00179's comment said erasure keeps a tombstone. It described a route that
--    did not exist: nothing in the product could delete a reference's data.
--    Holding a third party's contact details with no way to remove them is the
--    one obligation this table cannot defer, and a comment describing a feature
--    nobody built is exactly the claim-without-code defect this codebase keeps
--    finding.
create or replace function public.erase_candidate_reference(p_reference_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  hit integer;
begin
  if not public.is_admin() then
    raise exception 'Only an admin may erase a reference';
  end if;

  -- The contact details go; the row and its email_hash stay, so the same
  -- address cannot be silently re-added by this or any other candidate.
  update public.candidate_references
     set full_name    = null,
         job_title    = null,
         email        = null,
         country_code = null,
         erased_at    = now(),
         updated_at   = now()
   where id = p_reference_id
     and erased_at is null;
  get diagnostics hit = row_count;
  return hit > 0;
end;
$$;

revoke all on function public.erase_candidate_reference(uuid) from public, anon;
grant execute on function public.erase_candidate_reference(uuid) to authenticated;

comment on function public.erase_candidate_reference(uuid) is
  'Removes a reference''s personal data on request. Admin only. Keeps the row '
  'and its email_hash as a tombstone so the address cannot be re-added.';
