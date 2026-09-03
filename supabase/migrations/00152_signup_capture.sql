-- Atlas candidate vertical, step 1 (signup): the form now captures country,
-- role category, the two consents, a marketing opt-in and an optional
-- referral code AT signup. These live on profiles, not candidates — the
-- application-queue processor refuses to run when a candidates row already
-- exists (submit/route.ts returns 409), so signup must not create one. The
-- application form pre-fills from these and the queue processor can copy
-- them onto the candidates row it creates.

alter table public.profiles
  add column if not exists signup_country text,
  add column if not exists signup_role_category text,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists age_confirmed_at timestamptz,
  add column if not exists marketing_opt_in boolean not null default false,
  add column if not exists referral_code text;
