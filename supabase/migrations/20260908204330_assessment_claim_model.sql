-- Fix the entitlement lifecycle: a sitting in progress is not a spent one.
--
-- The first version stamped consumed_at when a sitting STARTED, while every
-- "has this candidate paid?" check asked for consumed_at IS NULL. Those two
-- decisions contradict each other, and the contradiction was not theoretical:
--
--   * A candidate mid-test who reloaded the page was shown "You don't have a
--     sitting yet" and offered the $5 test again, while their paid attempt
--     ran out its clock in the background.
--   * The dashboard, the /assessment gate and the checkout duplicate-guard
--     all read the same predicate, so all three agreed the paying candidate
--     had not paid — and checkout happily sold them a second sitting.
--   * An interview that died at question one on a vendor error had already
--     spent the $5 before a single word of audio existed.
--
-- The model now separates CLAIM from SETTLE:
--
--   claim   — the purchase is attached to a specific attempt. The candidate
--             cannot start a second sitting, but they still hold what they
--             paid for, so resuming works and nothing offers to sell it again.
--   settle  — the sitting was delivered. consumed_at is stamped; this is the
--             only state that ends the entitlement.
--   release — the sitting failed for OUR reasons. The claim is dropped and
--             they can sit it again on the same $5.
--
-- Release is deliberately preferred over refund where the candidate still
-- wants the assessment: giving someone their sitting is a better remedy than
-- giving back $5 and leaving them with nothing. flag_assessment_refund stays
-- for the cases where a sitting cannot be re-offered.

alter table public.assessment_purchases
  add column if not exists attempt_id uuid,
  add column if not exists released_count integer not null default 0;

comment on column public.assessment_purchases.attempt_id is
  'The test_attempts.id or ai_interviews.id this purchase is currently '
  'claimed by. NULL means the sitting has not started (or was released after '
  'a platform failure). Set by claim_assessment_entitlement.';

comment on column public.assessment_purchases.released_count is
  'How many times a claim was released after a platform failure. A purchase '
  'that keeps failing is a signal worth alerting on, not an infinite retry.';

-- Only one sitting of a kind can be under way at a time, and only one live
-- purchase can exist per kind. Both are the same index as before — the
-- predicate is what changed meaning, not the shape.
drop index if exists assessment_purchases_one_live_per_kind;
create unique index assessment_purchases_one_live_per_kind
  on public.assessment_purchases (candidate_id, kind)
  where status = 'paid' and consumed_at is null and refunded_at is null;

drop function if exists public.consume_assessment_entitlement(uuid, text);

-- Attach the purchase to the attempt that is about to run.
--
-- Returns the purchase id, or NULL when there is nothing to claim — either
-- unpaid, or already claimed by a DIFFERENT attempt. Re-claiming with the
-- SAME attempt id is idempotent, so a retried request cannot fail a sitting
-- that is legitimately its own.
create or replace function public.claim_assessment_entitlement(
  p_candidate_id uuid,
  p_kind text,
  p_attempt_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update assessment_purchases
     set attempt_id = p_attempt_id
   where id = (
     select id
       from assessment_purchases
      where candidate_id = p_candidate_id
        and kind = p_kind
        and status = 'paid'
        and consumed_at is null
        and refunded_at is null
        and (attempt_id is null or attempt_id = p_attempt_id)
      order by created_at
      limit 1
      for update skip locked
   )
  returning id into v_id;

  return v_id;
end;
$$;

-- The sitting was delivered. This is what actually spends the money.
create or replace function public.settle_assessment_entitlement(
  p_attempt_id uuid
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
   where attempt_id = p_attempt_id
     and status = 'paid'
     and consumed_at is null
     and refunded_at is null
  returning id into v_id;

  return v_id;
end;
$$;

-- The sitting failed on our side. Hand it back rather than keeping the money.
create or replace function public.release_assessment_entitlement(
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
     set attempt_id = null,
         released_count = released_count + 1,
         -- Keep the most recent reason for support to read. This is not a
         -- refund flag: refund_reason on an unrefunded row is what the refund
         -- worker settles, and a released sitting is being re-offered, not
         -- repaid.
         refund_reason = null
   where id = (
     select id
       from assessment_purchases
      where candidate_id = p_candidate_id
        and kind = p_kind
        and status = 'paid'
        and consumed_at is null
        and refunded_at is null
        and attempt_id is not null
      order by created_at
      limit 1
      for update skip locked
   )
  returning id into v_id;

  if v_id is not null then
    raise notice 'released assessment purchase % (%): %', v_id, p_kind, p_reason;
  end if;

  return v_id;
end;
$$;

revoke all on function public.claim_assessment_entitlement(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.settle_assessment_entitlement(uuid) from public, anon, authenticated;
revoke all on function public.release_assessment_entitlement(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_assessment_entitlement(uuid, text, uuid) to service_role;
grant execute on function public.settle_assessment_entitlement(uuid) to service_role;
grant execute on function public.release_assessment_entitlement(uuid, text, text) to service_role;
