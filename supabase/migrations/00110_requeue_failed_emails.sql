-- A way back for emails the drain gave up on.
--
-- email_outbox rows reach status='failed' and stay there forever. Grepping
-- src/, supabase/ and scripts/, the only writers of that column are the drain
-- route and reclaim_stranded_emails() (which only touches 'sending'). Nothing
-- moves 'failed' back to 'pending', and the table is revoked from anon and
-- authenticated (00098), so no client can either.
--
-- That was survivable only while nothing could fail an entire backlog at once.
-- Two things could:
--
--   1. The drain treats a PERMANENT failure as exhausted on attempt 1, not
--      after max_attempts, so a bad key or unverified sender burns rows at
--      BATCH_SIZE 50 per minute — 3,000 an hour, unattended.
--   2. classify() coerced the Resend SDK's `statusCode: null` (returned for ANY
--      fetch-level failure — DNS, reset, TLS, edge down) through Number(),
--      giving 0, which is neither undefined nor 429 nor 5xx. So a passing
--      network blip was classified permanent, and the exact fault the outbox
--      exists to absorb was the one guaranteed to burn the message.
--
-- Both are now fixed in the application, and a circuit breaker halts the drain
-- after 5 consecutive permanent failures. This function is the recovery for
-- anything already lost, and for whatever the next unforeseen fault burns.
--
-- ONE ROW PER ADDRESS, NEWEST ONLY. This is not a tidiness choice, it is
-- correctness. Every verification email embeds verifyUrl?token=<token>, but
-- profiles.email_verification_token holds only the MOST RECENT token — each
-- resend overwrites it — and verify-email matches on exact equality, redirecting
-- to ?error=invalid_token otherwise. Requeueing every failed row for an address
-- would therefore deliver a stack of emails of which at most one works, and the
-- recipient has no way to tell which. Sending one dead link is bad; sending
-- five and hoping is worse.
create or replace function public.requeue_failed_emails(
  p_since_hours integer default 24,
  p_email_type text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  with newest as (
    select distinct on (to_email) id
      from public.email_outbox
     where status = 'failed'
       and created_at > now() - make_interval(hours => p_since_hours)
       and (p_email_type is null or email_type = p_email_type)
     order by to_email, created_at desc
  )
  update public.email_outbox o
     set status          = 'pending',
         -- Reset rather than resume. The attempt budget was spent on a fault
         -- that was never this message's fault, so charging the message for it
         -- would just burn it again on the next hiccup.
         attempts        = 0,
         next_attempt_at = now(),
         claimed_at      = null,
         last_error      = null
    from newest n
   where o.id = n.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.requeue_failed_emails(integer, text) from public, anon, authenticated;
grant execute on function public.requeue_failed_emails(integer, text) to service_role;
