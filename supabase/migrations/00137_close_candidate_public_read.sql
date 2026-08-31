-- Found by the step-12 review, resolving a long-flagged exposure: the
-- row-level policy "Approved candidates are publicly visible" (00001) let
-- ANY holder of the browser anon key read EVERY column of every approved
-- candidate straight from PostgREST — email, full name, payout method, raw
-- bio — bypassing all app-layer masking. RLS filters rows, not columns.
--
-- Every legitimate cross-row read already goes through server routes with
-- the service client; the only browser cross-row reads were the two /hire
-- pages, which now read the vetted view below. Candidates keep their own
-- rows via "Candidates can read own record"; recruiters keep theirs.

drop policy if exists "Approved candidates are publicly visible" on public.candidates;

-- The RPC behind /api/candidates returns raw bio/tagline/insights; its only
-- caller uses the service client, so nobody else needs EXECUTE.
revoke execute on function public.get_candidates_with_skills(text,text,text,numeric,numeric,text,text,text,text[],text,integer,integer)
  from public, anon, authenticated;

-- The vetted, contact-free card the /hire pages actually need. The view
-- runs with owner rights on purpose: it exposes exactly these columns of
-- approved candidates and nothing else.
create or replace view public.candidate_hire_card as
  select id, display_name, hourly_rate, lock_status, role_category, country, profile_photo_url
  from public.candidates
  where admin_status = 'approved';

revoke all on public.candidate_hire_card from public, anon, authenticated;
grant select on public.candidate_hire_card to authenticated;
