-- Two-sided reviews, with a reveal rule that is read at query time.
--
-- Zero reviews have ever been written, against four "released" engagements that
-- were open between 40 seconds and 2.2 hours, never locked, never signed, and
-- never paid. Those are test clicks. Minting permanent public reputation from
-- them would be the worst possible first write to this table, so eligibility
-- keys on RELEASED MONEY, not on engagement status. Nothing qualifies today,
-- and the empty state is the screen.
--
-- The blind half already half-existed: "Reviews publicly readable" gated SELECT
-- on published = true, and there was no permissive UPDATE or DELETE policy — I
-- probed it as a real client and publishing early, rewriting a submitted review,
-- and reading an unpublished review about oneself were all refused. What was
-- missing is a DIRECTION and a rule that reveals.

begin;

-- 1. Close the write hole first. anon and authenticated hold INSERT and UPDATE
-- on every column, and the only permissive INSERT policy constrains client_id —
-- nothing about engagement_id, candidate_id, rating or published. The
-- restrictive aal2 policies do not help: mfa_satisfied() returns true for
-- anyone with no verified factor, and no client has one.
revoke insert, update on public.reviews from anon, authenticated;
drop policy if exists "Clients can insert own reviews" on public.reviews;

-- 2. Direction. client_id and candidate_id are the two PARTIES, not the author
-- and the subject — both halves of a pair carry the same pair of ids.
create type public.review_direction as enum ('client_to_candidate','candidate_to_client');
alter table public.reviews add column direction public.review_direction not null
  default 'client_to_candidate';
alter table public.reviews alter column direction drop default;

-- 3. One review per SIDE. The old unique index is (engagement_id, client_id),
-- which would reject the candidate's half of a pair as a duplicate.
drop index if exists public.reviews_engagement_client_key;
create unique index reviews_engagement_direction_key
  on public.reviews (engagement_id, direction);

-- 4. eligible_at was written and never read. reveal_at is read on every access.
alter table public.reviews drop column eligible_at;
alter table public.reviews add column reveal_at timestamptz not null;

-- 5. Eligibility: released money, one definition.
create or replace function public.review_window_opened_at(p_engagement uuid)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select least(
    (select min(p.released_at) from public.payment_periods p
      where p.engagement_id = p_engagement and p.status = 'released'
        and p.released_at is not null),
    (select min(m.released_at) from public.milestones m
      where m.engagement_id = p_engagement and m.status = 'released'
        and m.released_at is not null));
$$;

-- 6. The reveal, evaluated at read time rather than flipped by a cron: no
-- schedule to miss, no secret to fail open, no window where the database
-- disagrees with itself about whether something is visible.
--
-- SECURITY DEFINER is load-bearing, not stylistic: this is called from an RLS
-- policy ON reviews and itself queries reviews. Running as the table owner is
-- what stops that recursing — the same technique mfa_satisfied() uses.
create or replace function public.review_is_revealed(r public.reviews)
returns boolean language sql stable security definer set search_path = '' as $$
  select now() >= r.reveal_at
      or exists (select 1 from public.reviews o
                  where o.engagement_id = r.engagement_id
                    and o.direction <> r.direction);
$$;

-- 7. Two views, because candidate_id is a party and not a subject. One shared
-- view would let a reader pull the candidate's own outbound rating OF their
-- client and render it as a review of the candidate — and fold it into their
-- reputation score, since every existing reader filters on candidate_id alone.
create view public.candidate_reviews_public with (security_invoker = on) as
  select r.id, r.engagement_id, r.candidate_id, r.rating, r.body, r.submitted_at
    from public.reviews r
   where r.published and r.direction = 'client_to_candidate'
     and public.review_is_revealed(r);

create view public.client_reviews_private with (security_invoker = on) as
  select r.id, r.engagement_id, r.client_id, r.rating, r.body, r.submitted_at
    from public.reviews r
   where r.published and r.direction = 'candidate_to_client'
     and public.review_is_revealed(r);

grant select on public.candidate_reviews_public to anon, authenticated;
grant select on public.client_reviews_private  to authenticated;

-- 8. RLS catches up with the reveal rule.
drop policy if exists "Reviews publicly readable" on public.reviews;
create policy "Revealed reviews are readable" on public.reviews
  for select using (published and public.review_is_revealed(reviews));

-- 9. The only writer. Direction is derived from WHO IS CALLING; nothing in the
-- request body can name the subject or the publication state.
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

  -- Both halves share ONE reveal instant, snapshotted from the first
  -- submission. Deriving it per row would give the two parties different clocks.
  select r.reveal_at into v_anchor from public.reviews r
   where r.engagement_id = p_engagement_id limit 1;
  if v_anchor is null then v_anchor := now() + interval '30 days'; end if;

  insert into public.reviews (engagement_id, client_id, candidate_id, direction,
                              rating, body, reveal_at, published)
  values (p_engagement_id, v_client, v_candidate, v_dir, p_rating,
          nullif(btrim(coalesce(p_body, '')), ''), v_anchor, true)
  returning id into v_id;
  return v_id;
end $$;

-- 10. Withdraw, allowed only before reveal. review_is_revealed() turns true the
-- instant the second review lands, so once a pair is complete neither party can
-- pull theirs after reading the other's. That is the whole mechanism.
create or replace function public.withdraw_review(p_engagement_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_dir public.review_direction; v_client uuid; v_candidate uuid; v_n int;
begin
  select e.client_id, e.candidate_id into v_client, v_candidate
    from public.engagements e where e.id = p_engagement_id;
  if not found then return false; end if;
  if exists (select 1 from public.clients c
              where c.id = v_client and c.user_id = (select auth.uid()))
    then v_dir := 'client_to_candidate';
  elsif exists (select 1 from public.candidates c
                 where c.id = v_candidate and c.user_id = (select auth.uid()))
    then v_dir := 'candidate_to_client';
  else raise exception 'not a party to this engagement' using errcode = '42501';
  end if;

  with gone as (
    delete from public.reviews r
     where r.engagement_id = p_engagement_id and r.direction = v_dir
       and not public.review_is_revealed(r)
    returning 1)
  select count(*) into v_n from gone;
  return v_n > 0;
end $$;

revoke all on function public.submit_review(uuid,int,text) from public;
revoke all on function public.withdraw_review(uuid) from public;
grant execute on function public.submit_review(uuid,int,text) to authenticated;
grant execute on function public.withdraw_review(uuid) to authenticated;

commit;
