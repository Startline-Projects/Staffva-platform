-- 00221 — client identity verification and a card on file (client step 4).
--
-- src/lib/clientProfile.ts has said it plainly since it was written: "there
-- is no client verification of any kind". Candidates hand over a government
-- ID and a matching selfie before they can be seen; the person hiring them
-- proved nothing. These columns are the other half.
--
-- THE GATE, exactly as the owner locked it (D1): verification and a card on
-- file are required to FUND ESCROW — nothing else. Browsing, messaging,
-- interviewing, sending proposals and signing contracts all stay open to an
-- unverified client. That is a deliberate product decision and the copy
-- everywhere says "verify to fund", never "verify to hire". The Atlas
-- prototype's claim that verification "unlocks contract sending" is false
-- here by design.
--
-- Shape mirrors the candidate columns so the Stripe Identity stack is reused
-- rather than reinvented (api/identity/*, the webhook branches, and the same
-- status vocabulary). id_verification_reviewed_by carries the same meaning
-- it does there: a verdict a HUMAN wrote, which a self-serve retry button
-- must never reset.
alter table public.clients
  add column if not exists id_verification_status text not null default 'unverified',
  add column if not exists id_verification_submitted_at timestamptz,
  add column if not exists id_verification_verified_at timestamptz,
  add column if not exists identity_session_id text,
  add column if not exists id_verification_reviewed_by uuid references public.profiles(id),
  -- The card. Stripe holds the instrument; we keep only what the billing
  -- surface needs to name it, which is the same set Stripe returns on the
  -- PaymentMethod. No raw card data ever touches this database.
  add column if not exists payment_method_id text,
  add column if not exists payment_method_brand text,
  add column if not exists payment_method_last4 text,
  add column if not exists payment_method_exp_month int,
  add column if not exists payment_method_exp_year int,
  add column if not exists payment_method_added_at timestamptz;

alter table public.clients
  drop constraint if exists clients_id_verification_status_check;
alter table public.clients
  add constraint clients_id_verification_status_check check (
    id_verification_status in ('unverified', 'pending', 'passed', 'failed', 'manual_review')
  );

-- The webhook looks a client up by the Stripe session id it gets back.
create index if not exists clients_identity_session_idx
  on public.clients (identity_session_id)
  where identity_session_id is not null;

-- ── Where the gate lives ────────────────────────────────────────────────────
-- In api/escrow/fund, checked server-side before any PaymentIntent exists.
--
-- A client_may_fund() SQL function was drafted here and removed before
-- shipping. It had no callers — the funding route and the portal layout each
-- read the two columns directly — so it would have been a third definition
-- of "may this client move money" arriving in the same commit that argued
-- against having several. It was also `grant execute … to authenticated`
-- over an arbitrary client id, which handed every signed-in user a boolean
-- oracle on any client's verification and card state.
--
-- If a database-side rule is ever wanted (an RLS policy on payment rows, a
-- constraint), it should replace the route check rather than sit beside it.
--
-- Note what the gate does NOT cover: everything else. A client with no
-- verification can still browse, message, interview, send proposals and sign
-- contracts. They simply cannot move money.
