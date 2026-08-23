-- Three read-modify-write races, closed in the database.

-- ═══ 1. retake_count lost update ═══
-- api/test/submit read retake_count, added 1 in TypeScript, then wrote it
-- back. Two concurrent failing submissions both read N and both write N+1,
-- so one attempt vanishes -- and retake_count gates the retake lockout.
create or replace function public.increment_retake_count(p_candidate_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  update candidates
     set retake_count = coalesce(retake_count, 0) + 1
   where id = p_candidate_id
  returning retake_count;
$$;

revoke all on function public.increment_retake_count(uuid) from public, anon, authenticated;
grant execute on function public.increment_retake_count(uuid) to service_role;

-- ═══ 2. video-intro raffle tickets awarded twice ═══
-- api/admin/video-review checked the awarded flag, then set it, then
-- incremented the ticket count. Two admins approving the same video
-- concurrently both saw the flag false and both granted the bonus.
-- The UPDATE ... WHERE flag IS false is a compare-and-swap: exactly one
-- caller can flip it, and only that caller adds tickets.
create or replace function public.award_video_intro_raffle_tickets(
  p_candidate_id uuid,
  p_tickets integer default 3
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update candidates
     set video_intro_raffle_tickets_awarded = true
   where id = p_candidate_id
     and coalesce(video_intro_raffle_tickets_awarded, false) = false;

  if not found then
    return false;  -- someone else already awarded them
  end if;

  update giveaway_entries
     set raffle_ticket_count = coalesce(raffle_ticket_count, 0) + p_tickets
   where candidate_id = p_candidate_id;

  return true;
end;
$$;

revoke all on function public.award_video_intro_raffle_tickets(uuid, integer) from public, anon, authenticated;
grant execute on function public.award_video_intro_raffle_tickets(uuid, integer) to service_role;

-- ═══ 3. giveaway drawn twice ═══
-- select_winners had no guard at all: every POST inserted another winner
-- log row with different winners, and nothing marked which was real. A
-- double-click or two admins acting at once produced two authoritative
-- looking results. Only one draw may be active; a deliberate redraw must
-- supersede the previous one first.
alter table public.giveaway_winner_log
  add column if not exists superseded_at timestamptz;

create unique index if not exists giveaway_winner_log_single_active
  on public.giveaway_winner_log ((true))
  where superseded_at is null;
