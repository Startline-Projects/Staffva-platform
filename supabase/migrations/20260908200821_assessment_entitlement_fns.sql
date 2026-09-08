-- Claiming and refunding a purchased sitting.
--
-- Both functions are SECURITY DEFINER and callable ONLY by service_role: the
-- interview app and the English test route run with the service key, and
-- nothing a candidate's browser can reach may mark its own entitlement
-- consumed or refunded.

-- Claim one paid, unconsumed sitting. Returns the purchase id, or NULL when
-- the candidate has nothing to spend — the caller must treat NULL as "not
-- paid" and refuse to start.
--
-- FOR UPDATE SKIP LOCKED is the double-spend guard. Two tabs hitting Start at
-- the same instant: one takes the row lock and consumes, the other skips it
-- and gets NULL rather than waiting and consuming the same row twice.
create or replace function public.consume_assessment_entitlement(
  p_candidate_id uuid,
  p_kind text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update assessment_purchases
     set consumed_at = now()
   where id = (
     select id
       from assessment_purchases
      where candidate_id = p_candidate_id
        and kind = p_kind
        and status = 'paid'
        and consumed_at is null
        and refunded_at is null
      order by created_at
      limit 1
      for update skip locked
   )
  returning id into v_id;

  return v_id;
end;
$$;

-- Mark a sitting as owing the candidate their money back.
--
-- This does NOT talk to Stripe — it records the debt. A row with
-- refund_reason set and refunded_at still null is "refund owed", and the
-- platform's refund worker settles it. Splitting it this way is what makes it
-- crash-safe: if the Stripe call fails or the process dies mid-refund, the
-- debt is still on the row and the next run picks it up. A single combined
-- step would lose the obligation exactly when it mattered.
--
-- The case this exists for is not hypothetical. 29% of interview candidates
-- were once auto-rejected because OUR audio pipeline failed. Under a paid
-- model every one of those is a candidate who paid $5 to be failed by our
-- bug, and a marketplace that keeps that money is running a scam.
create or replace function public.flag_assessment_refund(
  p_candidate_id uuid,
  p_kind text,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update assessment_purchases
     set refund_reason = p_reason
   where id = (
     select id
       from assessment_purchases
      where candidate_id = p_candidate_id
        and kind = p_kind
        and status = 'paid'
        and consumed_at is not null
        and refunded_at is null
        and refund_reason is null
      order by consumed_at desc
      limit 1
      for update skip locked
   )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.consume_assessment_entitlement(uuid, text) from public, anon, authenticated;
revoke all on function public.flag_assessment_refund(uuid, text, text) from public, anon, authenticated;
grant execute on function public.consume_assessment_entitlement(uuid, text) to service_role;
grant execute on function public.flag_assessment_refund(uuid, text, text) to service_role;
