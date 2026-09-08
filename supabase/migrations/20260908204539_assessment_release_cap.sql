-- Cap how many times one purchase can be re-offered.
--
-- release_assessment_entitlement hands a sitting back when the platform is
-- what broke, which is right — but unbounded it becomes a way to farm the
-- question bank: start, abandon, restart, for ever, on one $5. It also hides
-- a real signal, because a purchase that keeps failing is usually a broken
-- account or a broken pipeline rather than bad luck.
--
-- After MAX_RELEASES the sitting is settled instead. That is the honest
-- stopping point: the candidate has been given the assessment three times.
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
  v_count integer;
  MAX_RELEASES constant integer := 2;
begin
  select id, released_count into v_id, v_count
    from assessment_purchases
   where candidate_id = p_candidate_id
     and kind = p_kind
     and status = 'paid'
     and consumed_at is null
     and refunded_at is null
     and attempt_id is not null
   order by created_at
   limit 1
   for update skip locked;

  if v_id is null then
    return null;
  end if;

  if v_count >= MAX_RELEASES then
    -- Out of re-offers. Settle it and return NULL so the caller falls through
    -- to its refund path.
    --
    -- Deliberately does NOT write refund_reason: on this table a non-null
    -- refund_reason with a null refunded_at means "we owe this person money",
    -- and that is exactly what the refund worker pays out. Writing a marker
    -- there would refund a candidate we had just given three sittings to.
    -- released_count already records what happened.
    update assessment_purchases
       set consumed_at = now()
     where id = v_id;
    return null;
  end if;

  update assessment_purchases
     set attempt_id = null,
         released_count = released_count + 1
   where id = v_id;

  raise notice 'released assessment purchase % (%): %', v_id, p_kind, p_reason;
  return v_id;
end;
$$;

revoke all on function public.release_assessment_entitlement(uuid, text, text) from public, anon, authenticated;
grant execute on function public.release_assessment_entitlement(uuid, text, text) to service_role;
