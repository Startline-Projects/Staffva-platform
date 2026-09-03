-- STEP 6: WhatsApp phone verification (Twilio Verify).
--
-- The phone lives on PROFILES, not candidates, on purpose. The candidates
-- row is only created when the application starts, but the Atlas pipeline
-- asks for the phone right after email verification — before /apply has
-- ever run. profiles exists from signup for every account, and a phone is
-- account-level identity anyway. One source of truth; nothing mirrors it
-- onto candidates (the recruiter-identity mess taught that lesson).

alter table public.profiles
  add column if not exists phone_number text,
  add column if not exists phone_verified_at timestamptz;

-- A VERIFIED number belongs to one account. Partial so an unverified
-- leftover (user typed a number, never finished) can't squat on it.
-- The verify route maps the 23505 from this into "already in use".
create unique index if not exists profiles_verified_phone_unique
  on public.profiles (phone_number)
  where phone_verified_at is not null;

comment on column public.profiles.phone_number is
  'E.164. Only meaningful when phone_verified_at is set — an unverified value is just the last number the user attempted.';
comment on column public.profiles.phone_verified_at is
  'Set by /api/phone/verify-code after Twilio Verify approves the code. Never set by client-writable paths.';
