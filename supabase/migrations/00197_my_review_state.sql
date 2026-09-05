-- 00197 — one query that answers "can I review this, and what happened to it?"
--
-- Both sides need the same four facts per engagement: is the window open, have
-- I submitted, has it been revealed, and what did they say. Computing that in
-- TypeScript would mean a second copy of the eligibility rule living next to
-- the one in 00196, free to drift from it — and the screens would still be
-- unable to show someone their OWN pending review, because the RLS policy on
-- reviews admits revealed rows only. That is correct for readers and wrong for
-- authors: "you can still withdraw it" is not a claim you can make on a screen
-- that cannot display the thing being withdrawn.
--
-- SECURITY DEFINER, with the caller's identity resolved inside rather than
-- passed in: nothing in the arguments can name a different party.

create or replace function public.my_review_state()
returns table (
  engagement_id uuid,
  your_role text,
  counterparty text,
  engagement_status text,
  window_opened_at timestamptz,
  you_submitted boolean,
  your_rating int,
  your_body text,
  your_submitted_at timestamptz,
  revealed boolean,
  reveal_at timestamptz,
  their_rating int,
  their_body text,
  their_submitted_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  with me as (
    select
      e.id,
      e.status::text as status,
      case when cl.user_id = (select auth.uid()) then 'client' else 'candidate' end as role,
      -- Each side sees THE OTHER. Written the wrong way round the first time,
      -- which handed the client back their own company name; the probe caught
      -- it. The candidate is named by display_name — "First L.", the same
      -- pseudonymous form every other client-facing surface uses — and the
      -- client by company, falling back to the person.
      case when cl.user_id = (select auth.uid())
           then coalesce(ca.display_name, 'Your hire')
           else coalesce(nullif(btrim(cl.company_name), ''), 'The client') end as counterparty
    from public.engagements e
    join public.clients cl    on cl.id = e.client_id
    join public.candidates ca on ca.id = e.candidate_id
    where cl.user_id = (select auth.uid()) or ca.user_id = (select auth.uid())
  ),
  -- Direction is derived from the role, never from a parameter.
  sided as (
    select me.*,
      (case when me.role = 'client' then 'client_to_candidate'
            else 'candidate_to_client' end)::public.review_direction as mine,
      (case when me.role = 'client' then 'candidate_to_client'
            else 'client_to_candidate' end)::public.review_direction as theirs
    from me
  )
  select
    s.id,
    s.role,
    s.counterparty,
    s.status,
    public.review_window_opened_at(s.id),
    (mine.id is not null),
    mine.rating,
    mine.body,
    mine.submitted_at,
    -- Revealed the moment both halves exist, or when the shared deadline
    -- passes. Read from whichever row exists, so a lone review still reports
    -- its own countdown.
    coalesce(theirs.id is not null
             or now() >= coalesce(mine.reveal_at, theirs.reveal_at), false),
    coalesce(mine.reveal_at, theirs.reveal_at),
    -- Their words are withheld until the reveal, in the query that returns
    -- them. Filtering in the caller would ship the text to a browser that has
    -- merely been asked not to render it.
    case when theirs.id is not null
          and (mine.id is not null or now() >= theirs.reveal_at)
          and theirs.published
         then theirs.rating end,
    case when theirs.id is not null
          and (mine.id is not null or now() >= theirs.reveal_at)
          and theirs.published
         then theirs.body end,
    case when theirs.id is not null
          and (mine.id is not null or now() >= theirs.reveal_at)
          and theirs.published
         then theirs.submitted_at end
  from sided s
  left join public.reviews mine
         on mine.engagement_id = s.id and mine.direction = s.mine
  left join public.reviews theirs
         on theirs.engagement_id = s.id and theirs.direction = s.theirs
  order by public.review_window_opened_at(s.id) desc nulls last;
$$;

revoke all on function public.my_review_state() from public;
grant execute on function public.my_review_state() to authenticated;
