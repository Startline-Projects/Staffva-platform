-- 00213: Realtime for the candidate-facing message tables (Atlas 4.18 —
-- messages arrive without a reload; the app has polled at 30-60s until now).
--
-- Supabase Realtime only broadcasts tables that sit in the supabase_realtime
-- publication, which this project never created. Delivery stays RLS-gated
-- per subscriber: both tables carry participant-scoped SELECT policies
-- ("Candidates/Clients can read own messages" from 00001; "Read own thread"
-- on recruiter_messages) plus the 00161 aal2 restrictive policy, and
-- postgres_changes evaluates policies per row against the subscriber's JWT.
-- Nothing here widens what any role can read.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'recruiter_messages'
  ) then
    alter publication supabase_realtime add table public.recruiter_messages;
  end if;
end $$;
