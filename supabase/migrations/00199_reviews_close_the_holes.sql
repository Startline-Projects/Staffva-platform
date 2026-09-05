-- 00199 — the four holes an adversarial review found in 00196/00197.
-- Nothing here is theoretical: every grant below was confirmed against the live
-- database with has_table_privilege / has_function_privilege before it was written.
--
-- 1. THE DEADLINE MADE THE BLIND ONE-SIDED.
--    submit_review() checked released money and the unique index, and nothing
--    else. So once reveal_at passed with only one review in, the party who had
--    NOT written could read the other's — on the candidate's own public profile,
--    no less — and then submit theirs. The anchor lookup reuses the existing
--    row's reveal_at, which by then is in the past, so the retaliatory review
--    published the instant it committed and could never be withdrawn, while the
--    person who wrote in good faith on day 0 lost that right on day 30. The
--    product told both of them "what you write can't affect what they write".
--
-- 2. anon COULD READ EVERYTHING.
--    00196 revoked insert and update on public.reviews and left SELECT alone, and
--    the new policy is role-blind: `for select using (published and revealed)`.
--    With the publishable key that ships in the browser bundle, a signed-out
--    request to /rest/v1/reviews returned BOTH halves of every revealed pair —
--    including candidate_to_client rows carrying candidate_id, so a candidate's
--    criticism of a client was attributable to them on the open web. That is the
--    precise read the two views were split apart to prevent.
--
-- 3. "PRIVATE" WAS PUBLIC.
--    `grant select on client_reviews_private to authenticated` does not exclude
--    anon: Supabase's default privileges had already granted anon arw on the new
--    view. Live ACL: {anon=arw/postgres,...}. The name was the only thing private
--    about it.
--
-- 4. THE FUNCTIONS WERE AN ORACLE.
--    `revoke all ... from public` left anon's explicit grant intact — anon held
--    EXECUTE on all five functions. review_is_revealed() takes a caller-supplied
--    composite, so anyone could hand it a synthetic row with reveal_at far in the
--    future and read back "does the counterparty's review exist yet", which is
--    exactly the pre-reveal fact the whole design hides. review_window_opened_at()
--    likewise reported another party's payment timeline, bypassing RLS on
--    payment_periods and milestones.

-- ── The views become the boundary, instead of merely describing one ──────────
-- security_invoker = off: the view runs as its owner, so the caller needs no
-- privilege on public.reviews at all. That is what lets the grants below take
-- SELECT away from anon and authenticated on the base table without breaking the
-- public profile. The view's own WHERE clause is now the entire gate, and the
-- named column list is what keeps a future column from leaking through it.
drop view if exists public.candidate_reviews_public;
drop view if exists public.client_reviews_private;

create view public.candidate_reviews_public with (security_invoker = off) as
  select r.id, r.engagement_id, r.candidate_id, r.rating, r.body, r.submitted_at,
         nullif(split_part(coalesce(cl.full_name, ''), ' ', 1), '') as client_first_name
    from public.reviews r
    left join public.clients cl on cl.id = r.client_id
   where r.published and r.direction = 'client_to_candidate'
     and public.review_is_revealed(r);

create view public.client_reviews_private with (security_invoker = off) as
  select r.id, r.engagement_id, r.client_id, r.rating, r.body, r.submitted_at
    from public.reviews r
   where r.published and r.direction = 'candidate_to_client'
     and public.review_is_revealed(r);

revoke all on public.candidate_reviews_public from anon, authenticated;
revoke all on public.client_reviews_private  from anon, authenticated;

-- Reviews OF a candidate are public by design: they render on a profile page
-- that signed-out visitors can read. SELECT only — anon arrived holding arw.
grant select on public.candidate_reviews_public to anon, authenticated;

-- Reviews of a CLIENT get no browser grant at all. Nothing reads this view yet;
-- granting it to `authenticated` would have let any signed-in account read every
-- client's file, which is not what "private" can be allowed to mean. It stays
-- reachable by the service role for the staff screen, and gets a real grant when
-- there is a client-reputation surface with a real access rule behind it.

-- ── The base table stops being readable from a browser ──────────────────────
revoke select on public.reviews from anon, authenticated;
drop policy if exists "Revealed reviews are readable" on public.reviews;
-- No policy replaces it. With no SELECT grant there is nothing for a policy to
-- qualify, and leaving one behind would suggest a read path that no longer
-- exists. Every legitimate read goes through candidate_reviews_public, through
-- my_review_state(), or through the service role in /api/admin/reviews.

-- ── The helpers stop being callable from outside ────────────────────────────
-- Both are invoked from a definer view and from definer functions, which run as
-- the owner, so no caller needs EXECUTE on them.
revoke execute on function public.review_is_revealed(public.reviews) from public, anon, authenticated;
revoke execute on function public.review_window_opened_at(uuid)      from public, anon, authenticated;
revoke execute on function public.submit_review(uuid,int,text) from anon;
revoke execute on function public.withdraw_review(uuid)        from anon;
revoke execute on function public.my_review_state()            from anon;

-- ── submit_review: refuse once the other half is readable ───────────────────
create or replace function public.submit_review(
  p_engagement_id uuid, p_rating int, p_body text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_client uuid; v_candidate uuid;
  v_dir public.review_direction; v_anchor timestamptz; v_id uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5
    then raise exception 'rating must be 1-5' using errcode = '22023'; end if;

  select e.client_id, e.candidate_id into v_client, v_candidate
    from public.engagements e where e.id = p_engagement_id;
  if not found then raise exception 'engagement not found' using errcode = '42501'; end if;

  if exists (select 1 from public.clients c
              where c.id = v_client and c.user_id = v_uid) then
    v_dir := 'client_to_candidate';
  elsif exists (select 1 from public.candidates c
                 where c.id = v_candidate and c.user_id = v_uid) then
    v_dir := 'candidate_to_client';
  else raise exception 'not a party to this engagement' using errcode = '42501';
  end if;

  if public.review_window_opened_at(p_engagement_id) is null
    then raise exception 'no released payment on this engagement' using errcode = '42501'; end if;

  select r.reveal_at into v_anchor from public.reviews r
   where r.engagement_id = p_engagement_id limit 1;

  -- The gate this function was missing. Past the anchor, the existing review is
  -- already public, so a review written now would be written by someone who has
  -- read the other one — and would publish immediately, since it inherits an
  -- anchor that has already passed. A blind exchange has to refuse a late entry
  -- rather than accept one and call it blind.
  if v_anchor is not null and now() >= v_anchor then
    raise exception 'the review window on this engagement has closed'
      using errcode = '42501';
  end if;

  if v_anchor is null then v_anchor := now() + interval '30 days'; end if;

  insert into public.reviews (engagement_id, client_id, candidate_id, direction,
                              rating, body, reveal_at, published)
  values (p_engagement_id, v_client, v_candidate, v_dir, p_rating,
          nullif(btrim(coalesce(p_body, '')), ''), v_anchor, true)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.submit_review(uuid,int,text) from public, anon;
grant execute on function public.submit_review(uuid,int,text) to authenticated;

-- ── my_review_state: stop leaking that the other side has written ───────────
-- The old shape returned `revealed` as `theirs exists OR deadline passed`, and
-- returned reveal_at unconditionally. For someone who had written nothing that
-- combination said "they have already submitted" — and since reveal_at is
-- exactly their submitted_at plus 30 days, it also gave their submission time to
-- the second, through a column the query took care to null out elsewhere.
--
-- The replacement answers only what the caller is entitled to know:
--   can_submit    — may I write one right now
--   their_visible — am I allowed to read theirs
--   reveal_at     — my own countdown, and NULL until I have submitted (or until
--                   the window has closed, when it is no longer a secret)
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
      -- Each side sees THE OTHER. The candidate is named by display_name —
      -- "First L.", the pseudonymous form every client-facing surface uses. The
      -- client is named by company, falling back to the PERSON: 9 of 24 client
      -- rows have no company_name, and an earlier version fell back to the
      -- literal "The client", so a third of candidates would have been asked
      -- "How was working with The client?"
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
      mine.submitted_at as mine_at, mine.reveal_at as mine_reveal,
      theirs.id as theirs_id, theirs.rating as theirs_rating, theirs.body as theirs_body,
      theirs.submitted_at as theirs_at, theirs.reveal_at as theirs_reveal,
      theirs.published as theirs_published,
      coalesce(mine.reveal_at, theirs.reveal_at) as anchor
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
    -- Writable while money has moved, I have not written, and no existing
    -- review has passed its anchor. Mirrors submit_review() exactly.
    (public.review_window_opened_at(j.id) is not null
      and j.mine_id is null
      and not coalesce(now() >= j.anchor, false)),
    (j.mine_id is not null),
    j.mine_rating,
    j.mine_body,
    j.mine_at,
    -- Theirs becomes readable when I have written, or when the anchor passes.
    -- Not merely when it exists: that is the whole blind.
    coalesce(j.theirs_id is not null and j.theirs_published
             and (j.mine_id is not null or now() >= j.theirs_reveal), false),
    case when j.theirs_id is not null and j.theirs_published
          and (j.mine_id is not null or now() >= j.theirs_reveal)
         then j.theirs_rating end,
    case when j.theirs_id is not null and j.theirs_published
          and (j.mine_id is not null or now() >= j.theirs_reveal)
         then j.theirs_body end,
    case when j.theirs_id is not null and j.theirs_published
          and (j.mine_id is not null or now() >= j.theirs_reveal)
         then j.theirs_at end,
    coalesce(now() >= j.anchor, false),
    -- My own countdown. NULL while I have written nothing and the window is
    -- still open, because in that state the anchor can only have come from
    -- THEIR submission, and handing it back is how the old version disclosed
    -- both that they had written and precisely when.
    case when j.mine_id is not null or coalesce(now() >= j.anchor, false)
         then j.anchor end
  from joined j
  order by public.review_window_opened_at(j.id) desc nulls last;
$$;

revoke all on function public.my_review_state() from public, anon;
grant execute on function public.my_review_state() to authenticated;
