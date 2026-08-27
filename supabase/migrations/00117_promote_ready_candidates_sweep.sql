-- A safety net for the promotion in 00116.
--
-- Promotion is triggered by whichever event completes a candidate: passing the
-- interview, or finishing Build Your Profile. That is fine until one of those
-- calls fails -- a network blip, a deploy mid-request -- because a candidate
-- with no remaining steps of their own has no second chance to trigger it. They
-- would sit fully qualified and never go live, which is the exact failure this
-- whole change set exists to stop.
--
-- So sweep. This finds candidates who are still in the funnel and have passed an
-- interview, and asks 00116 about each one. It deliberately does NOT repeat the
-- ten gate conditions: duplicating them is how two approval routes drifted apart
-- before. The cheap predicate here only narrows the set; promote_candidate_if_ready
-- remains the sole judge of who is ready.
--
-- Set-based rather than a list of ids fetched and passed back in, because
-- PostgREST serialises .in() into the URL and runs out of room around 1,650 ids
-- -- fine at today's 52 interviews, not at the 10,000 this is being built for.
create or replace function public.promote_ready_candidates(p_limit int default 500)
returns table(candidate_id uuid, new_status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  return query
  with ready as (
    select c.id
      from public.candidates c
     where c.admin_status::text in ('active', 'pending_2nd_interview')
       and coalesce(c.permanently_blocked, false) = false
       and exists (
         select 1 from public.ai_interviews i
          where i.candidate_id = c.id and i.status = 'completed' and i.passed
       )
     order by c.id
     limit greatest(coalesce(p_limit, 500), 0)
  )
  select r.id, public.promote_candidate_if_ready(r.id)
    from ready r;
end;
$fn$;

-- Cron only. Candidates promote themselves through 00116, which checks
-- ownership; this one takes no caller identity into account at all, so it must
-- never be reachable by anyone but the server.
revoke all on function public.promote_ready_candidates(int) from public, anon, authenticated;
grant execute on function public.promote_ready_candidates(int) to service_role;
