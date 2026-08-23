-- The drain reclaimed rows stranded in 'sending' but left `attempts`
-- untouched, so a message that consistently hangs past maxDuration would be
-- killed, reclaimed, and retried forever without ever reaching max_attempts,
-- failing, or writing vendor_failures. An infinite quiet loop.
--
-- This has to be SQL rather than a supabase-js .update(), because the client
-- cannot express `attempts = attempts + 1` -- it can only write a literal, and
-- reading-then-writing would reintroduce the lost-update race that has bitten
-- this codebase repeatedly.
create or replace function public.reclaim_stranded_emails(
  p_stranded_after_seconds integer default 300
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reclaimed integer;
begin
  with stranded as (
    update public.email_outbox
       set status     = case
                          -- Count the killed attempt. If that exhausts the
                          -- budget the row fails now rather than cycling.
                          when attempts + 1 >= max_attempts then 'failed'
                          else 'pending'
                        end,
           attempts   = attempts + 1,
           claimed_at = null,
           last_error = 'reclaimed: invocation died mid-send'
     where status = 'sending'
       and claimed_at < now() - make_interval(secs => p_stranded_after_seconds)
    returning 1
  )
  select count(*) into v_reclaimed from stranded;

  return v_reclaimed;
end;
$$;

revoke all on function public.reclaim_stranded_emails(integer) from public, anon, authenticated;
grant execute on function public.reclaim_stranded_emails(integer) to service_role;
