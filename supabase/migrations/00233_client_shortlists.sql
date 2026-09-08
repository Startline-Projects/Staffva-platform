-- 00233 — named shortlists and saved searches (client vertical step 8).
--
-- Atlas gives a client three shortlists in a dropdown, a heart on every card,
-- and a "save this search" modal with email-frequency radios. None of it
-- persists there: the confirm button closes the modal and nothing is written.
-- These are the tables that make it real.
--
-- WITHOUT public share links, per the owner's D6. Atlas shares a shortlist by
-- anyone-with-the-link URL showing candidate names and rates — that is
-- candidate data leaving the authenticated product, and it is not shipping
-- until someone decides it should.
--
-- On saved_candidates (00001): a client-bookmark table with a UNIQUE
-- (client_id, candidate_id) and no writer anywhere in the codebase — the
-- heart it was built for was never wired. It is superseded rather than
-- extended: a bookmark now belongs to a NAMED list, and retrofitting a
-- shortlist_id onto a table with that unique constraint would forbid the same
-- candidate appearing in two lists, which is the first thing anyone will do.
-- Left in place, unused, rather than dropped — nothing reads it, and dropping
-- a table is not something a feature migration should do quietly.

create table public.client_shortlists (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  -- The list the heart writes to when the client hasn't chosen one. Exactly
  -- one per client, enforced below.
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index client_shortlists_one_default
  on public.client_shortlists (client_id)
  where is_default;

-- Two lists with the same name is a UI bug waiting to happen, not a feature.
create unique index client_shortlists_name_per_client
  on public.client_shortlists (client_id, lower(btrim(name)));

create table public.client_shortlist_members (
  shortlist_id uuid not null references public.client_shortlists(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (shortlist_id, candidate_id)
);

create index client_shortlist_members_candidate
  on public.client_shortlist_members (candidate_id);

create table public.client_saved_searches (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  -- The browse filter set, stored as the query the client actually built.
  -- Kept as jsonb rather than columns because /browse's filters change shape
  -- between steps and a saved search must survive that.
  filters jsonb not null default '{}'::jsonb,
  -- 'off' | 'daily' | 'weekly'. Atlas offers "immediately" too; nothing here
  -- watches the pool in real time, so that option is not offered.
  notify text not null default 'off'
    check (notify in ('off', 'daily', 'weekly')),
  -- The high-water mark for "N new": the count the client last SAW, not the
  -- count at save time. Without this, "3 new" would keep saying 3 forever.
  last_seen_count integer not null default 0,
  last_seen_at timestamptz not null default now(),
  -- The SECOND high-water mark, and it has to be separate from the first.
  -- The digest asks "has this risen since I last mentioned it"; the page asks
  -- "has this risen since the client last looked". Sharing one column forces
  -- a choice between two bugs: advance it on send and the "+3 more" badge is
  -- cleared by an email nobody opened; don't, and the daily digest re-sends
  -- the identical message every day forever, because the only thing that
  -- moves last_seen_count is a click on /shortlists that most recipients
  -- will never make.
  last_notified_count integer not null default 0,
  last_notified_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index client_saved_searches_name_per_client
  on public.client_saved_searches (client_id, lower(btrim(name)));

create index client_saved_searches_notify
  on public.client_saved_searches (notify)
  where notify <> 'off';

-- ── Access ──────────────────────────────────────────────────────────────────
-- Read-own, and no browser writes at all. Every mutation goes through a
-- service-role route that checks ownership, which is the shape 00230 settled
-- on after 00001's FOR-ALL policies turned out to be the recurring hole in
-- this schema.
alter table public.client_shortlists enable row level security;
alter table public.client_shortlist_members enable row level security;
alter table public.client_saved_searches enable row level security;

revoke all on public.client_shortlists from anon, authenticated;
revoke all on public.client_shortlist_members from anon, authenticated;
revoke all on public.client_saved_searches from anon, authenticated;
grant select on public.client_shortlists to authenticated;
grant select on public.client_shortlist_members to authenticated;
grant select on public.client_saved_searches to authenticated;

create policy "Read own shortlists" on public.client_shortlists
  for select to authenticated
  using (exists (select 1 from public.clients c
                  where c.id = client_shortlists.client_id
                    and c.user_id = (select auth.uid())));

create policy "Read own shortlist members" on public.client_shortlist_members
  for select to authenticated
  using (exists (select 1 from public.client_shortlists s
                  join public.clients c on c.id = s.client_id
                 where s.id = client_shortlist_members.shortlist_id
                   and c.user_id = (select auth.uid())));

create policy "Read own saved searches" on public.client_saved_searches
  for select to authenticated
  using (exists (select 1 from public.clients c
                  where c.id = client_saved_searches.client_id
                    and c.user_id = (select auth.uid())));

-- A shortlist names people a client is considering, and a saved search
-- describes what they are hiring for — both sit behind the same aal2 gate as
-- the rest of the client's data (00161).
create policy "MFA-enrolled must use aal2" on public.client_shortlists
  as restrictive for all to authenticated
  using ((select public.mfa_satisfied()));

create policy "MFA-enrolled must use aal2" on public.client_shortlist_members
  as restrictive for all to authenticated
  using ((select public.mfa_satisfied()));

create policy "MFA-enrolled must use aal2" on public.client_saved_searches
  as restrictive for all to authenticated
  using ((select public.mfa_satisfied()));
