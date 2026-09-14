-- admin_status 'approved' -> 'live': objects, triggers, rows.
--
-- "Approved" read as a judgment; it never was one. The gate is six profile
-- fields and two recordings — 225 of 253 live candidates took no assessment
-- at all. Done additively so no deployed query ever asks about a label that
-- does not exist: enum gained 'live' (previous file), objects accept BOTH,
-- app deployed accepting both and writing 'live' (df42fd6 / 47bfaab), rows
-- moved LAST.
--
-- Applied to production 2026-09-13/14 via MCP as three calls:
--   admin_status_objects_accept_live   (7 functions, RLS policy)
--   candidate_hire_card_accept_live    (the view, grants preserved via
--                                       CREATE OR REPLACE — column list
--                                       unchanged, so no drop, no default-
--                                       privilege re-grant)
--   admin_status_rows_to_live          (triggers + the 253-row update)
--
-- This file is the consolidated replayable form. Objects are patched from
-- their own live definitions (pg_get_functiondef), never retyped.

do $mig$
declare
  v_def text; v_before text; fn text;
  reads text[] := array[
    'candidate_is_matchable','candidate_open_slots','iv_slot_is_open',
    'job_rate_stats','release_candidate_references','block_closes_listing',
    'get_candidates_with_skills'
  ];
begin
  foreach fn in array reads loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;
    if v_def is null then raise exception 'function % not found', fn; end if;
    v_before := v_def;
    v_def := replace(v_def, 'c.admin_status::text = ''approved''',
                            'c.admin_status::text in (''approved'', ''live'')');
    v_def := replace(v_def, 'c.admin_status = ''approved''',
                            'c.admin_status::text in (''approved'', ''live'')');
    v_def := replace(v_def, 'new.admin_status = ''approved''::admin_status_type',
                            'new.admin_status::text in (''approved'', ''live'')');
    v_def := replace(v_def, 'WHERE admin_status = ''approved''::admin_status_type',
                            'WHERE admin_status::text in (''approved'', ''live'')');
    -- Idempotent on replay: already-patched definitions match nothing, and
    -- that is fine — only fail when the function has NEVER been patched.
    if v_def <> v_before then execute v_def; end if;
  end loop;

  -- The write: promotion lands on 'live'.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'promote_candidate_if_ready';
  v_def := replace(v_def, 'set admin_status = ''approved'',', 'set admin_status = ''live'',');
  execute v_def;

  -- The approval audit records the literal it moved them to.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_candidate_approval';
  v_def := replace(v_def, 'old.admin_status::text, ''approved'',', 'old.admin_status::text, ''live'',');
  execute v_def;

  -- The hire-card view: CREATE OR REPLACE keeps identity AND grants
  -- (authenticated has SELECT here; a DROP would re-apply default privileges).
  v_def := pg_get_viewdef('public.candidate_hire_card'::regclass, true);
  v_before := v_def;
  v_def := replace(v_def, 'WHERE admin_status = ''approved''::admin_status_type',
                          'WHERE admin_status::text in (''approved'', ''live'')');
  if v_def <> v_before then
    execute 'create or replace view public.candidate_hire_card as ' || v_def;
  end if;
end
$mig$;

-- RLS: portfolio items visible for live candidates, either label.
drop policy if exists "Portfolio items publicly visible for approved candidates" on public.portfolio_items;
drop policy if exists "Portfolio items publicly visible for live candidates" on public.portfolio_items;
create policy "Portfolio items publicly visible for live candidates"
  on public.portfolio_items for select
  using (exists (
    select 1 from public.candidates c
     where c.id = portfolio_items.candidate_id
       and c.admin_status::text in ('approved', 'live')
  ));

-- TRIGGERS BEFORE ROWS. Both approval triggers fired WHEN new = 'approved',
-- so (a) they stay silent during the row move below — no notification storm
-- for 253 rows — and (b) unchanged they would NEVER fire again once
-- promotions write 'live'. Label-agnostic now: fire on entering the live
-- state from outside it, under either name.
drop trigger if exists candidate_approved_notification on public.candidates;
create trigger candidate_approved_notification
  after update of admin_status on public.candidates
  for each row
  when (new.admin_status::text in ('approved','live')
        and old.admin_status::text not in ('approved','live'))
  execute function notify_candidate_approved();

drop trigger if exists candidate_approved_status_event on public.candidates;
create trigger candidate_approved_status_event
  after update of admin_status on public.candidates
  for each row
  when (new.admin_status::text in ('approved','live')
        and old.admin_status::text not in ('approved','live'))
  execute function record_candidate_approval();

-- The rows. touch_availability_stamp only fires on availability changes
-- (checked), so nobody's freshness stamp moves; updated_at bumping is
-- expected. Verified after the live run: 0 approved / 253 live, and browse
-- returned the same 253 with an IDENTICAL order fingerprint.
update public.candidates
   set admin_status = 'live'
 where admin_status = 'approved';

notify pgrst, 'reload schema';
