-- Migration 00086 — add_increment_cheat_flag_function
--
-- Parameterized replacement for the exec_sql dynamic UPDATE that api/test/cheat-log
-- previously used to increment candidates.cheat_flag_count. The old code string-built
-- SQL from the request body (SQL injection). This function takes a typed uuid argument
-- (which cannot carry SQL), is atomic, has a fixed search_path, and is callable only by
-- the service_role. Applied to the live DB via the Supabase migration tooling.

create or replace function public.increment_cheat_flag(p_candidate_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.candidates
     set cheat_flag_count = coalesce(cheat_flag_count, 0) + 1
   where id = p_candidate_id;
$$;

revoke execute on function public.increment_cheat_flag(uuid) from public;
revoke execute on function public.increment_cheat_flag(uuid) from anon;
revoke execute on function public.increment_cheat_flag(uuid) from authenticated;
grant  execute on function public.increment_cheat_flag(uuid) to service_role;
