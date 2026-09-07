-- 00214: the dashboard tour's write-once "seen it" stamp (Atlas tour —
-- 3 spotlight stops on the live dashboard). Same shape as going_live_ack_at
-- (00186): no direct column grant, a self-scoped SECURITY DEFINER RPC is the
-- only writer, and it never un-sets. The prototype forgets tour completion
-- (no persistence); a tour that replays on every login is nagware, so ours
-- persists per candidate, across devices.
alter table public.candidates
  add column if not exists tour_seen_at timestamptz;

create or replace function public.ack_dashboard_tour()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.candidates
     set tour_seen_at = now()
   where user_id = auth.uid()
     and tour_seen_at is null;
end;
$$;

revoke all on function public.ack_dashboard_tour() from public;
grant execute on function public.ack_dashboard_tour() to authenticated;
