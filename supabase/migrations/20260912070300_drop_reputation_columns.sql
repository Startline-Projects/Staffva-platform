-- Drop the reputation columns. The system itself went in 0125849.
--
-- Nothing in either app has read or written these since that commit, but they
-- were still being SHIPPED to the browse client on every search — 252 stale
-- scores travelling to the browser for no reason, and a live-looking column a
-- future change could wire back up by mistake.
--
-- The 252 rows were exported to ~/staffva-reputation-backup-2026-09-12.json
-- before this ran. reputation_tier was NULL for every candidate; 252 had a
-- score and 191 a percentile.
--
-- ORDER MATTERS. The view depends on the columns, so DROP COLUMN fails while
-- it exists (and CASCADE would take the view with it). The function does not
-- block the drop — plpgsql bodies are not dependency-checked — but it would
-- start failing at runtime the moment the columns went, so it is rewritten in
-- the same transaction. View, then function, then the columns.
--
-- APPLIED to production as two calls: drop_reputation_columns, then
-- drop_reputation_columns_restore_view_grants once the grant widening above
-- was caught. This file is the combined, replayable form.
--
-- The view's 164 columns are read from the catalog rather than retyped: the
-- view deliberately exposes 164 of the table's 168, and re-listing those by
-- hand is exactly how one gets silently dropped. Same reasoning for the
-- function — it is patched from its own live definition, so nothing outside
-- the two reputation names can drift.

do $mig$
declare
  v_cols text;
  v_def  text;
begin
  -- ── 1. matchable_candidates ────────────────────────────────────────────
  -- CREATE OR REPLACE VIEW cannot REMOVE a column, only append, so the view
  -- has to be dropped and rebuilt. That loses its grants, which are restored
  -- below to exactly what it had: ALL to service_role (postgres owns it).
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'matchable_candidates'
     and column_name not in ('reputation_score', 'reputation_tier', 'reputation_percentile');

  if v_cols is null then
    raise exception 'matchable_candidates has no columns — refusing to rebuild it blind';
  end if;

  drop view public.matchable_candidates;
  execute format(
    'create view public.matchable_candidates as select %s from candidates c where candidate_is_matchable(c.*)',
    v_cols
  );
  execute 'grant all on public.matchable_candidates to service_role';
  -- And take back what the rebuild handed out. Dropping the view made it a
  -- NEW object, so Supabase's ALTER DEFAULT PRIVILEGES for the public schema
  -- applied and gave anon and authenticated privileges it never had. The view
  -- exposes 161 candidate columns and is owner-run, not security_invoker — a
  -- SELECT through it does not pass the RLS policies on candidates, so
  -- anything granted here is granted around them. Original ACL was exactly
  -- postgres + service_role.
  execute 'revoke all on public.matchable_candidates from anon';
  execute 'revoke all on public.matchable_candidates from authenticated';
  execute 'revoke all on public.matchable_candidates from public';

  -- ── 2. get_candidates_with_skills ──────────────────────────────────────
  -- The return type does not name these columns (checked), so CREATE OR
  -- REPLACE is enough and the function keeps its grants. Both occurrences sit
  -- in SELECT lists inside the body.
  select pg_get_functiondef(p.oid)
    into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_candidates_with_skills';

  if v_def is null then
    raise exception 'get_candidates_with_skills not found';
  end if;

  v_def := replace(
    v_def,
    'english_comprehension_score, reputation_score, reputation_tier,',
    'english_comprehension_score,'
  );

  -- Refuse to install a half-patched function: it would reference columns
  -- that the next statement deletes.
  if position('reputation' in v_def) > 0 then
    raise exception 'reputation still referenced in get_candidates_with_skills after patching';
  end if;

  execute v_def;

  -- ── 3. The columns ─────────────────────────────────────────────────────
  alter table public.candidates
    drop column reputation_score,
    drop column reputation_tier,
    drop column reputation_percentile;
end
$mig$;

notify pgrst, 'reload schema';
