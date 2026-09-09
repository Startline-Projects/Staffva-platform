-- Client profile fields.
--
-- The clients table is name + email + company_name and four dead subscription
-- columns. Everything a candidate is told about who is hiring them comes from
-- those two name fields — on the offer they receive, in its email, and in the
-- notification. There is nowhere for a client to say anything else, and
-- /api/offers already carries a comment noting company_name is unverified free
-- text a client typed at signup.
--
-- These four columns are added because step 18 RENDERS all four on a page a
-- candidate can actually reach. A profile editor writing fields nothing
-- displays is a dead control with a database bill attached.
--
-- Deliberately NOT added:
--   * a public slug / vanity URL. There is no public client page: the profile
--     is visible to candidates this client has actually contacted, and to
--     nobody else. A slug would imply an address anyone can visit.
--   * a "profile visible" toggle. With no public page there is nothing for it
--     to switch off, and a toggle that changes nothing is worse than none.
--   * logo/photo upload. No client-side storage bucket exists yet, and an
--     Upload button with no destination is exactly the dead control this
--     rebuild keeps removing.

alter table public.clients
  add column if not exists headline    text,
  add column if not exists bio         text,
  add column if not exists website_url text,
  add column if not exists timezone    text;

-- Bounded so a candidate-facing page cannot be used as an arbitrary-length
-- content host, and so the offer page's layout holds.
alter table public.clients
  drop constraint if exists clients_headline_len,
  add constraint clients_headline_len check (headline is null or char_length(headline) <= 120);

alter table public.clients
  drop constraint if exists clients_bio_len,
  add constraint clients_bio_len check (bio is null or char_length(bio) <= 1200);

alter table public.clients
  drop constraint if exists clients_website_len,
  add constraint clients_website_len check (website_url is null or char_length(website_url) <= 300);

alter table public.clients
  drop constraint if exists clients_timezone_len,
  add constraint clients_timezone_len check (timezone is null or char_length(timezone) <= 64);

comment on column public.clients.headline is
  'Self-reported one-liner shown to candidates this client has contacted. Unverified, like company_name.';
comment on column public.clients.bio is
  'Self-reported description shown on the client profile a candidate reaches from an offer. Unverified.';
