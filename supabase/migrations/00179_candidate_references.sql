-- Employment references: a former manager's name and email, typed in by the
-- candidate.
--
-- This is the first table in the product that holds the personal data of
-- someone who is not a user. The reference has never visited StaffVA, did not
-- agree to anything, and will not know we hold their address until we write to
-- them. Everything below follows from that.
--
-- WHY NOT IN candidates.work_experience, which is where Atlas puts it:
-- that column is returned key-for-key to UNAUTHENTICATED callers by
-- /api/candidates/preview, and the masker spread every key through and patched
-- only two. A reference's email placed there would have been public the moment
-- the candidate pressed Save. (The masker is now an allowlist — see
-- src/lib/contactMask.ts — but the right fix is also to keep this data out of
-- a blob that is designed to be published.)

create table if not exists public.candidate_references (
  id             uuid primary key default gen_random_uuid(),
  candidate_id   uuid not null references public.candidates(id) on delete cascade,
  -- Which employer in candidates.work_experience this vouches for. A key, not
  -- an FK, because work history is jsonb and stays that way — normalising it
  -- would break the edit-request flow, the masker and both review modals.
  employer_key   text not null,

  full_name      text,
  job_title      text,
  email          text,
  -- ISO-3166 alpha-2. Collected because which rules apply to contacting
  -- someone depends on where they are. NOTHING is claimed to the candidate
  -- about what the country does — see the note on public reviews below.
  country_code   text check (country_code is null or country_code ~ '^[A-Z]{2}$'),

  -- Consent, recorded the way this codebase already records consent
  -- (interview_consent{,_at,_version}). Note what it is: the CANDIDATE's
  -- attestation that they asked this person. It is not the reference's own
  -- consent, which we cannot obtain before we contact them, and the copy says
  -- so rather than pretending otherwise.
  consent_asserted    boolean not null default false,
  consent_asserted_at timestamptz,
  consent_copy_version text,

  -- The outreach lifecycle. In step 11 it can only ever hold its default.
  contact_state  text not null default 'never_contacted'
                 check (contact_state in ('never_contacted', 'queued', 'sent', 'responded', 'bounced')),
  -- Stamped by release_candidate_references() and by nothing else.
  released_at    timestamptz,

  -- Erasure keeps a tombstone so the same address cannot be silently re-added
  -- after someone has asked to be forgotten.
  erased_at      timestamptz,
  email_hash     text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- THE PROMISE, AS A CONSTRAINT.
  --
  -- The candidate is told "we are not contacting anyone yet". This is what
  -- makes that true in the database rather than in prose: no row can claim it
  -- was queued, sent, answered or bounced unless a release has been stamped.
  -- It holds against every client, including service_role, including a future
  -- cron somebody writes without reading this file.
  constraint candidate_references_no_contact_before_release
    check (contact_state = 'never_contacted' or released_at is not null),

  -- One reference per employer, so the form cannot be used to fan a message
  -- out to a list of addresses.
  constraint candidate_references_one_per_employer
    unique (candidate_id, employer_key)
);

create index if not exists candidate_references_candidate_idx
  on public.candidate_references (candidate_id);

-- At most five per candidate. Enforced with a trigger because a CHECK cannot
-- count sibling rows.
create or replace function public.candidate_references_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  select count(*) into n
    from public.candidate_references r
   where r.candidate_id = new.candidate_id
     and r.id <> new.id;
  if n >= 5 then
    raise exception 'A candidate may hold at most 5 references';
  end if;
  return new;
end;
$$;

drop trigger if exists candidate_references_cap_trg on public.candidate_references;
create trigger candidate_references_cap_trg
  before insert on public.candidate_references
  for each row execute function public.candidate_references_cap();

-- ── Access ────────────────────────────────────────────────────────────────
-- RLS on, and deliberately NO policies. Service-role bypasses RLS; everyone
-- else matches nothing and sees nothing. A recruiter who needs to see that a
-- reference exists gets a MASKED view through a server route, never the row.
--
-- Plaintext email has no reader at all in step 11. There is nothing to send,
-- so there is nothing that needs to read an address.
alter table public.candidate_references enable row level security;
revoke all on public.candidate_references from authenticated, anon;

comment on table public.candidate_references is
  'Third-party personal data. Service-role only: RLS is on with zero policies '
  'and no grants. Plaintext email has NO reader in the product — staff surfaces '
  'render a masked form. See src/lib/emailFreeze.ts for why nothing sends.';

comment on column public.candidate_references.contact_state is
  'Guarded by candidate_references_no_contact_before_release: it cannot leave '
  '''never_contacted'' unless released_at is set, and only '
  'release_candidate_references() sets that.';

comment on column public.candidate_references.consent_asserted is
  'The CANDIDATE''s attestation that they asked this person — not the '
  'reference''s own consent, which cannot be obtained before first contact. '
  'The lawful basis at outreach time is legitimate interest with notice '
  'delivered IN the first message, which is a blocker on the outreach step.';

-- ── The one writer of released_at ─────────────────────────────────────────
--
-- Called from nowhere. It exists so that when outreach is eventually built,
-- the release is a deliberate, authenticated, MFA-gated act by a human who
-- approved this specific candidate — not a flag somebody flips.
--
-- Deliberately NOT keyed on admin_status alone: 30 of the 31 currently
-- approved candidates were flipped by migration 00151 rather than reviewed by
-- a person, and engagements/direct-invite creates candidates already stamped
-- 'approved' with no review at all. Releasing those would contact references
-- for people nobody ever looked at.
create or replace function public.release_candidate_references(p_candidate_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if not public.is_admin() then
    raise exception 'Only an admin may release references';
  end if;
  if not public.mfa_satisfied() then
    raise exception 'MFA is required to release references';
  end if;

  if not exists (
    select 1 from public.candidates c
     where c.id = p_candidate_id
       and c.admin_status = 'approved'
  ) then
    raise exception 'Candidate is not approved';
  end if;

  update public.candidate_references
     set released_at = now(), updated_at = now()
   where candidate_id = p_candidate_id
     and released_at is null
     and erased_at is null
     and consent_asserted;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.release_candidate_references(uuid) from public, anon, authenticated;

comment on function public.release_candidate_references(uuid) is
  'Lifts the no-contact constraint for one approved candidate. Admin + MFA '
  'only. CALLED FROM NOWHERE in step 11 — no outreach exists. When it does, '
  'this is the deliberate act that permits it, and the candidate must be told '
  'before it happens.';
