-- 00200 — tell the two states apart: "they never wrote one" and "staff removed
-- the one they wrote".
--
-- their_visible folds theirs_published into itself, so both cases arrive at the
-- screen as false and the card said "the deadline passed without a review from
-- them" for both. For the takedown case that is a false account of what
-- happened, printed on the one record of the exchange either party has — the
-- same class of defect as the copy this step set out to fix, introduced by the
-- fix for it.
--
-- their_withheld discloses only that a review existed, and only to someone who
-- is already past the reveal point. Before the reveal it stays false, so it
-- opens no new inference channel.

drop function if exists public.my_review_state();
create function public.my_review_state()
returns table (
  engagement_id uuid,
  your_role text,
  counterparty text,
  engagement_status text,
  window_opened_at timestamptz,
  can_submit boolean,
  you_submitted boolean,
  your_rating int,
  your_body text,
  your_submitted_at timestamptz,
  their_visible boolean,
  their_withheld boolean,
  their_rating int,
  their_body text,
  their_submitted_at timestamptz,
  window_closed boolean,
  reveal_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  with me as (
    select
      e.id,
      e.status::text as status,
      case when cl.user_id = (select auth.uid()) then 'client' else 'candidate' end as role,
      case when cl.user_id = (select auth.uid())
           then coalesce(ca.display_name, 'Your hire')
           else coalesce(nullif(btrim(cl.company_name), ''),
                         nullif(btrim(cl.full_name), ''), 'The client') end as counterparty
    from public.engagements e
    join public.clients cl    on cl.id = e.client_id
    join public.candidates ca on ca.id = e.candidate_id
    where cl.user_id = (select auth.uid()) or ca.user_id = (select auth.uid())
  ),
  sided as (
    select me.*,
      (case when me.role = 'client' then 'client_to_candidate'
            else 'candidate_to_client' end)::public.review_direction as mine,
      (case when me.role = 'client' then 'candidate_to_client'
            else 'client_to_candidate' end)::public.review_direction as theirs
    from me
  ),
  joined as (
    select s.*,
      mine.id as mine_id, mine.rating as mine_rating, mine.body as mine_body,
      mine.submitted_at as mine_at,
      theirs.id as theirs_id, theirs.rating as theirs_rating, theirs.body as theirs_body,
      theirs.submitted_at as theirs_at, theirs.reveal_at as theirs_reveal,
      theirs.published as theirs_published,
      coalesce(mine.reveal_at, theirs.reveal_at) as anchor,
      -- "Am I past the point where their half stops being secret?"
      coalesce(mine.id is not null or now() >= theirs.reveal_at, false) as past_seal
    from sided s
    left join public.reviews mine
           on mine.engagement_id = s.id and mine.direction = s.mine
    left join public.reviews theirs
           on theirs.engagement_id = s.id and theirs.direction = s.theirs
  )
  select
    j.id,
    j.role,
    j.counterparty,
    j.status,
    public.review_window_opened_at(j.id),
    (public.review_window_opened_at(j.id) is not null
      and j.mine_id is null
      and not coalesce(now() >= j.anchor, false)),
    (j.mine_id is not null),
    j.mine_rating,
    j.mine_body,
    j.mine_at,
    (j.theirs_id is not null and j.theirs_published and j.past_seal),
    (j.theirs_id is not null and not j.theirs_published and j.past_seal),
    case when j.theirs_id is not null and j.theirs_published and j.past_seal
         then j.theirs_rating end,
    case when j.theirs_id is not null and j.theirs_published and j.past_seal
         then j.theirs_body end,
    case when j.theirs_id is not null and j.theirs_published and j.past_seal
         then j.theirs_at end,
    coalesce(now() >= j.anchor, false),
    case when j.mine_id is not null or coalesce(now() >= j.anchor, false)
         then j.anchor end
  from joined j
  order by public.review_window_opened_at(j.id) desc nulls last;
$$;

revoke all on function public.my_review_state() from public, anon;
grant execute on function public.my_review_state() to authenticated;
