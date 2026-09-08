-- Candidates can buy an assessment sitting.
--
-- Nothing in this platform has ever charged a candidate: Stripe is used for
-- clients paying into escrow, candidates RECEIVING payouts over Connect, and
-- Stripe Identity. This adds the other direction.
--
-- Two objects only:
--   * candidates.stripe_customer_id — mirrors the column clients already
--     carry, so a returning candidate reuses their customer record and their
--     saved local payment method.
--   * assessment_purchases — one row per purchased sitting.
--
-- The entitlement rule is deliberately "one paid, unconsumed, unrefunded row
-- per kind", not a counter on the candidate. A counter cannot answer "did
-- THIS attempt correspond to a payment", which is exactly what a refund needs
-- to know when our own audio pipeline is what failed the sitting.
--
-- consumed_at is stamped when the ATTEMPT STARTS, not at payment. A candidate
-- who pays and closes the tab keeps their entitlement.
alter table public.candidates
  add column if not exists stripe_customer_id text;

create unique index if not exists candidates_stripe_customer_id_key
  on public.candidates (stripe_customer_id)
  where stripe_customer_id is not null;

create table if not exists public.assessment_purchases (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  -- Which sitting this buys. Matches the two optional assessments.
  kind text not null check (kind in ('english', 'interview')),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'usd',
  -- Stripe references. Unique so a redelivered webhook cannot create a second
  -- entitlement from one payment.
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'refunded', 'failed')),
  -- Stamped when the sitting actually begins.
  consumed_at timestamptz,
  refunded_at timestamptz,
  -- Why we gave the money back. 'platform_failure' is the one that matters:
  -- 29% of interview candidates were once auto-rejected because OUR audio
  -- pipeline failed, and every one of those would now be a paid failure.
  refund_reason text,
  created_at timestamptz not null default now()
);

create index if not exists assessment_purchases_candidate_idx
  on public.assessment_purchases (candidate_id, kind, status);

-- The entitlement lookup: at most one live unconsumed entitlement per kind, so
-- a candidate cannot be charged twice for a sitting they have not taken.
create unique index if not exists assessment_purchases_one_live_per_kind
  on public.assessment_purchases (candidate_id, kind)
  where status = 'paid' and consumed_at is null;

alter table public.assessment_purchases enable row level security;
revoke all on public.assessment_purchases from anon, authenticated;

-- Read-own, so a candidate can see what they paid for. No INSERT/UPDATE from
-- the browser: rows are created by the checkout route and only ever moved to
-- 'paid' by the Stripe webhook, which is the sole authority on whether money
-- actually arrived.
grant select on public.assessment_purchases to authenticated;

create policy "Candidates read own assessment purchases"
  on public.assessment_purchases for select to authenticated
  using (
    exists (
      select 1 from public.candidates c
      where c.id = assessment_purchases.candidate_id
        and c.user_id = (select auth.uid())
    )
  );

-- Same aal2 rule as every other candidate-facing table (see the MFA
-- enforcement migration): an MFA-enrolled user must be at aal2 to read.
create policy "MFA-enrolled must use aal2"
  on public.assessment_purchases as restrictive for all to authenticated
  using ((select public.mfa_satisfied()))
  with check ((select public.mfa_satisfied()));

comment on table public.assessment_purchases is
  'One purchased assessment sitting. Entitlement = status paid, consumed_at '
  'null, refunded_at null. Written only by the checkout route and the Stripe '
  'webhook; candidates read their own rows and write none.';
