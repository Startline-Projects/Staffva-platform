-- Bound the free sitting by something a refund cannot erase.
--
-- 20260911201321 defined "free go already spent" as a row that is
-- status='paid' AND consumed_at IS NOT NULL AND refunded_at IS NULL, so that a
-- sitting WE broke — which gets refunded — would hand the free go back rather
-- than being eaten by our own failure.
--
-- That is the right intent and the wrong mechanism: the refund CLEARS both
-- conjuncts, so the row stops counting as spent and the next start mints a
-- brand new 0-cent row with released_count back at 0 — which also resets the
-- MAX_RELEASES=2 farming cap from 20260908204539. Unbounded, and reachable
-- without paying anything.
--
-- Worse, the trigger is candidate-controlled on the interview side: the
-- transcript text is taken from the request body, the scorer counts a turn as
-- silent by exact-matching the literal string the client sends, and three of
-- those park the sitting. Release, release, cap, settle, flag, refund,
-- re-mint. The English side needs no candidate action at all — any vendor
-- failure parks the attempt, the worker refunds it, and it is re-granted.
--
-- Three changes, all inside the predicate:
--
--   1. A HARD LIFETIME CAP on 0-cent rows per candidate per kind. Counting
--      rows regardless of status is the part a refund cannot undo. Three, so
--      that a candidate would have to be broken by us three separate times
--      before meeting a paywall for our fault; the release cap already
--      absorbs interruptions WITHIN a sitting, so this only counts whole
--      sittings lost. One constant to change if that proves wrong.
--
--   2. A row owed a refund (refund_reason set, refunded_at still null) no
--      longer counts as spent. The refund worker runs every 10 minutes, and
--      in that window a candidate was told their free go was used and offered
--      a $5 retake for a sitting we had already decided to give back.
--
--   3. A 'pending' purchase blocks a grant. A delayed local payment method
--      sits at 'pending' until it clears; minting a free row on top of it
--      meant the webhook could credit a second sitting for money already
--      taken.

create or replace function public.grant_free_assessment_sitting(
  p_candidate_id uuid,
  p_kind text
) returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id uuid;
  v_free_count integer;
  MAX_FREE_SITTINGS constant integer := 3;
begin
  if p_kind not in ('english', 'interview') then
    raise exception 'unknown assessment kind %', p_kind using errcode = '22023';
  end if;

  -- (1) The bound a refund cannot erase: count every 0-cent row ever written
  -- for this candidate and kind, whatever became of it.
  select count(*) into v_free_count
    from assessment_purchases
   where candidate_id = p_candidate_id
     and kind = p_kind
     and amount_cents = 0;

  if v_free_count >= MAX_FREE_SITTINGS then
    return null;
  end if;

  -- (2) Spent: a sitting that completed, was not refunded, and is not waiting
  -- to be refunded. This is a retake, and retakes are paid.
  if exists (
    select 1 from assessment_purchases
     where candidate_id = p_candidate_id
       and kind = p_kind
       and status = 'paid'
       and consumed_at is not null
       and refunded_at is null
       and refund_reason is null
  ) then
    return null;
  end if;

  -- (3) Already holding something live, bought or free or still clearing.
  if exists (
    select 1 from assessment_purchases
     where candidate_id = p_candidate_id
       and kind = p_kind
       and status in ('paid', 'pending')
       and consumed_at is null
       and refunded_at is null
  ) then
    return null;
  end if;

  begin
    insert into assessment_purchases (candidate_id, kind, amount_cents, currency, status)
    values (p_candidate_id, p_kind, 0, 'usd', 'paid')
    returning id into v_id;
  exception when unique_violation then
    return null;
  end;

  return v_id;
end;
$function$;

revoke all on function public.grant_free_assessment_sitting(uuid, text) from public;
revoke all on function public.grant_free_assessment_sitting(uuid, text) from anon;
revoke all on function public.grant_free_assessment_sitting(uuid, text) from authenticated;
grant execute on function public.grant_free_assessment_sitting(uuid, text) to service_role;

notify pgrst, 'reload schema';
