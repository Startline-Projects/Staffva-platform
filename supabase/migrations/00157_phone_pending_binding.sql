-- Step-6 review fix: bind Twilio verification checks to the account that
-- started them.
--
-- Twilio Verify keys its pending-verification state on (service, phone) —
-- GLOBAL across our users, with shared 5-send/5-check budgets. Without a
-- server-side record of who sent to which number, any authenticated account
-- could (a) burn a victim's check budget with wrong guesses so the victim's
-- correct code returns too_many_checks, and (b) use the incorrect-vs-expired
-- error split as an oracle for "is this phone mid-verification right now".
--
-- send-code records the claim here after a successful Twilio send;
-- verify-code refuses (with a response indistinguishable from a wrong code)
-- to check any phone the caller has no fresh claim on. Cleared on success.
alter table public.profiles
  add column if not exists phone_pending_number text,
  add column if not exists phone_pending_sent_at timestamptz;

comment on column public.profiles.phone_pending_number is
  'E.164 the user last asked Twilio Verify to send a code to. Only /api/phone/verify-code reads it, to bind checks to the sender.';
comment on column public.profiles.phone_pending_sent_at is
  'When that send happened. Claims older than 15 minutes are dead (Twilio verifications live 10).';
