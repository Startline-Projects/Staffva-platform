-- The fields the Atlas profile builder captures that StaffVA had nowhere to put.
--
-- Everything here is additive and nullable. Nothing existing changes meaning,
-- and — deliberately — no approval gate is touched. checkApprovalGates,
-- promote_candidate_if_ready, isFullyComplete and the four approve routes all
-- enumerate resume_url, payout_method and interview_consent_at; the rebuild
-- keeps collecting all three rather than dropping resume or renaming payout to
-- match Atlas, because changing the step set and the gates together is how a
-- cohort quietly stops being promotable.

alter table public.candidates
  -- Atlas shows "Buenos Aires, Argentina". We had country only.
  add column if not exists city text,
  -- The candidate's own words for what they do, distinct from role_category,
  -- which is the taxonomy value that drives routing, browse pills and the
  -- Interview 2 task. A free-text title must never be mistaken for that.
  add column if not exists role_title text,
  -- CAPACITY OFFERED. Emphatically NOT committed_hours, which means hours
  -- already booked to clients: match/route.ts computes `available = 50 -
  -- committed_hours`, so writing "I can work 40 hours" into that column would
  -- read as "40 hours are already gone, 10 remain" and bury the candidate.
  add column if not exists hours_per_week integer
    check (hours_per_week is null or (hours_per_week > 0 and hours_per_week <= 60)),
  -- Free text: "8am-1pm PHT, flexible for US mornings".
  add column if not exists working_hours text,
  add column if not exists payout_currency text
    check (payout_currency is null or payout_currency in ('usd', 'php')),
  -- jsonb rather than tables. Employers already live in work_experience jsonb,
  -- and the edit-request flow, the contact masker, EditModal and ReviewModal
  -- all speak that shape — normalising would mean changing a CHECK constraint,
  -- two field lists, a labels map and both modal renderers to gain nothing the
  -- profile needs.
  add column if not exists education jsonb,
  add column if not exists certifications jsonb,
  add column if not exists languages jsonb,
  -- Draft persistence. The builder held all of its state in useState and
  -- nowhere else, so a refresh, a dead battery or a dropped connection erased
  -- everything — and the Atlas step set roughly triples how much that is.
  add column if not exists profile_draft jsonb,
  add column if not exists profile_draft_at timestamptz;

comment on column public.candidates.hours_per_week is
  'How many hours a week the candidate WANTS to work. committed_hours is the '
  'opposite — hours already booked. Anything computing spare capacity should '
  'read coalesce(hours_per_week, 50) - committed_hours.';

comment on column public.candidates.role_title is
  'The candidate''s own job title, shown on their profile. role_category is the '
  'taxonomy value and is what routing, browse pills and the Interview 2 task '
  'read. Do not substitute one for the other.';

comment on column public.candidates.profile_draft is
  'Autosaved builder state. Written by the candidate as they go and read only '
  'to repopulate the form; no other surface may read it, and nothing here is '
  'part of the published profile until they submit.';

-- THE GRANT. Do not remove it, and copy this note onto the next migration that
-- adds a browser-written column to this table.
--
-- public.candidates has NO table-level UPDATE grant for `authenticated`: 00120
-- revoked it and re-granted column by column, and those column grants are "the
-- actual lock" in that migration's own words. So a newly added column is
-- writable by nobody, `add column` inherits nothing, and nothing fails until a
-- candidate presses Submit at the end of an eight-step form and gets
-- "permission denied for table candidates" — after their photo, résumé and
-- portfolio files are already in storage.
--
-- An earlier version of this migration ended with `revoke update (...) from
-- anon` and a comment saying nothing else gained a writer. That revoke was a
-- no-op — anon has held SELECT only since 00120 — and it is exactly what made
-- the privilege question look already answered. 00183 added the grant; it is
-- repeated here so a fresh replay is correct in one pass.
grant update (
  city, role_title, hours_per_week, working_hours,
  payout_currency, education, certifications, languages
) on public.candidates to authenticated;

-- profile_draft and profile_draft_at are deliberately NOT granted: the autosave
-- route writes them under the service role.
