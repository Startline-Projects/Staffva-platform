-- 00201 — the views stop depending on a function grant they cannot provide.
--
-- 00199 revoked EXECUTE on review_is_revealed() from anon and authenticated to
-- close an oracle: the function takes a caller-supplied composite, so anyone
-- could hand it a synthetic row with reveal_at far in the future and read back
-- "does the counterparty's review exist yet" — the exact pre-reveal fact the
-- design hides.
--
-- That revoke also broke the public candidate profile for browser callers, and
-- the reason is a Postgres rule worth writing down: a view encapsulates
-- privileges on the TABLES it reads, but NOT EXECUTE on the functions it calls.
-- Function ACLs are checked against the invoking user even inside a
-- security_invoker = off view. So `grant select on candidate_reviews_public to
-- anon` became a grant that could not be exercised — a permission the schema
-- advertised and the database refused. It went unnoticed because both app-side
-- readers use the service role, which kept its EXECUTE; only a real browser
-- request would have hit it.
--
-- Inlining the predicate fixes both: the oracle stays shut and the view works
-- for the roles it is granted to. review_is_revealed() survives because
-- withdraw_review() still calls it — that runs SECURITY DEFINER as the owner,
-- which has EXECUTE. The two copies of the rule must stay in step, so if you
-- change one, change the other.

drop view if exists public.candidate_reviews_public;
drop view if exists public.client_reviews_private;

create view public.candidate_reviews_public with (security_invoker = off) as
  select r.id, r.engagement_id, r.candidate_id, r.rating, r.body, r.submitted_at,
         nullif(split_part(coalesce(cl.full_name, ''), ' ', 1), '') as client_first_name
    from public.reviews r
    left join public.clients cl on cl.id = r.client_id
   where r.published and r.direction = 'client_to_candidate'
     -- review_is_revealed(r), inlined. See the note above.
     and (now() >= r.reveal_at
          or exists (select 1 from public.reviews o
                      where o.engagement_id = r.engagement_id
                        and o.direction <> r.direction));

create view public.client_reviews_private with (security_invoker = off) as
  select r.id, r.engagement_id, r.client_id, r.rating, r.body, r.submitted_at
    from public.reviews r
   where r.published and r.direction = 'candidate_to_client'
     and (now() >= r.reveal_at
          or exists (select 1 from public.reviews o
                      where o.engagement_id = r.engagement_id
                        and o.direction <> r.direction));

revoke all on public.candidate_reviews_public from anon, authenticated;
revoke all on public.client_reviews_private  from anon, authenticated;
grant select on public.candidate_reviews_public to anon, authenticated;
