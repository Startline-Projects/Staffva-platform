-- First sitting free, retakes paid — for both assessments.
--
-- The assessments became optional and the candidate started paying for them.
-- Nobody ever did: assessment_purchases is EMPTY, so the $5 paywall has
-- refused 100% of attempts since it shipped, and 68% of candidates are in the
-- Philippines where Stripe offers no local method at all. The owner's call is
-- to make the first go free and charge only for retakes.
--
-- This grants entitlement through the SAME machinery a purchase uses — a row
-- in assessment_purchases with amount_cents = 0 and status = 'paid' — rather
-- than adding a second way past the gate. claim/settle, the one-live-per-kind
-- index, the release cap and the refund worker all keep working untouched,
-- and "who used a free sitting" stays answerable from one table.
-- amount_cents >= 0 is the existing CHECK, so zero was always legal.
--
-- WHAT "FIRST" MEANS. Not a one-time coupon: a free sitting is spent only by
-- a sitting that actually completed. One we broke is refunded, and a refunded
-- row deliberately does not count — otherwise our own failure would eat the
-- candidate's free attempt and then ask them for $5.

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
begin
  if p_kind not in ('english', 'interview') then
    raise exception 'unknown assessment kind %', p_kind using errcode = '22023';
  end if;

  -- A sitting that completed and was not refunded means the free one is
  -- spent. This is a retake, and retakes are paid.
  if exists (
    select 1 from assessment_purchases
     where candidate_id = p_candidate_id
       and kind = p_kind
       and status = 'paid'
       and consumed_at is not null
       and refunded_at is null
  ) then
    return null;
  end if;

  -- Already holding a live entitlement, free or paid. Granting a second would
  -- violate assessment_purchases_one_live_per_kind anyway.
  if exists (
    select 1 from assessment_purchases
     where candidate_id = p_candidate_id
       and kind = p_kind
       and status = 'paid'
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
    -- Two requests raced for the same free sitting; the other one won and the
    -- candidate holds exactly one. Not an error.
    return null;
  end;

  return v_id;
end;
$function$;

-- Same posture as claim/settle: service_role only. A candidate who could call
-- this could mint themselves unlimited sittings.
revoke all on function public.grant_free_assessment_sitting(uuid, text) from public;
revoke all on function public.grant_free_assessment_sitting(uuid, text) from anon;
revoke all on function public.grant_free_assessment_sitting(uuid, text) from authenticated;
grant execute on function public.grant_free_assessment_sitting(uuid, text) to service_role;

notify pgrst, 'reload schema';
