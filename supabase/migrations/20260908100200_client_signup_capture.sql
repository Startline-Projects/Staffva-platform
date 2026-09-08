-- Client vertical, step 1 (Atlas client signup + cleanup).
--
-- Capture: the rebuilt /signup/client records what it asks for. The two
-- consents, country and marketing opt-in reuse the role-agnostic profiles
-- columns from 00152 (terms_accepted_at, age_confirmed_at, marketing_opt_in,
-- signup_country). What is client-specific lands here on clients:
--   hiring_for      — the "What are you hiring for?" chips, our real browse
--                     role categories (not the prototype's 11 slugs). Later
--                     steps read this for browse prefill and dashboard
--                     suggestions; it ships persisted or the chips don't ship.
--   referral_source — "How did you hear about StaffVA?", fixed enum.
-- Both vocabularies live in src/lib/signupCapture.ts (derived from
-- roleTaxonomy) — the CHECK constraints below are their frozen SQL copies;
-- change one and you must ship both.
alter table public.clients
  add column if not exists hiring_for text[],
  add column if not exists referral_source text;

alter table public.clients
  drop constraint if exists clients_referral_source_check;
alter table public.clients
  add constraint clients_referral_source_check check (
    referral_source is null or referral_source in (
      'google', 'social', 'referral', 'press', 'podcast',
      'newsletter', 'event', 'other'
    )
  );

alter table public.clients
  drop constraint if exists clients_hiring_for_check;
alter table public.clients
  add constraint clients_hiring_for_check check (
    hiring_for is null or hiring_for <@ array[
      'Paralegal', 'Legal Assistant', 'Bookkeeping/AP', 'Admin', 'VA',
      'Cold Caller', 'Sales', 'SDR', 'SEO', 'Marketing', 'Scheduling',
      'Customer Support', 'Medical', 'E-Commerce', 'Other'
    ]::text[]
  );

-- ── The trigger owns signup capture ─────────────────────────────────────────
-- Since 00205 fixed handle_new_user, the trigger inserts the profiles row
-- (and the clients row for role 'client') SYNCHRONOUSLY inside
-- auth.signUp — before /api/ensure-profile can run. Both of that route's
-- upserts use ON CONFLICT DO NOTHING, so every capture field it carried
-- (consents, country, role category, referral) has been silently dropped
-- for every trigger-created signup — the adversarial review caught it on
-- this step, and it had been eating the CANDIDATE capture since 00205.
--
-- The durable shape: the signup pages put the capture in
-- raw_user_meta_data, and the trigger — the actual row creator — persists
-- it atomically. ensure-profile remains the belt for the trigger's
-- swallowed-exception path (its inserts carry the same fields when it is
-- the one creating the rows).
--
-- Everything read from raw_user_meta_data is untrusted client input:
-- values are checked against the same allowlists as the CHECK constraints,
-- the consents stamp only when explicitly 'true', and hiring_for is
-- deduplicated and capped — a poisoned value must degrade to NULL, never
-- abort the auth signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_allowed_categories constant text[] := array[
    'Paralegal', 'Legal Assistant', 'Bookkeeping/AP', 'Admin', 'VA',
    'Cold Caller', 'Sales', 'SDR', 'SEO', 'Marketing', 'Scheduling',
    'Customer Support', 'Medical', 'E-Commerce', 'Other'
  ];
  v_terms boolean := (v_meta->>'terms_accepted') = 'true';
  v_age boolean := (v_meta->>'age_confirmed') = 'true';
  v_country text := nullif(trim(coalesce(v_meta->>'signup_country', '')), '');
  v_role_category text;
  v_referral_code text;
  v_referral_source text;
  v_hiring_for text[];
begin
  v_role_category := v_meta->>'signup_role_category';
  if v_role_category is null or not (v_role_category = any(v_allowed_categories)) then
    v_role_category := null;
  end if;

  v_referral_code := v_meta->>'referral_code';
  if v_referral_code is null or v_referral_code !~ '^[A-Za-z0-9_-]{1,64}$' then
    v_referral_code := null;
  end if;

  v_referral_source := v_meta->>'referral_source';
  if v_referral_source is null or not (v_referral_source = any(array[
    'google', 'social', 'referral', 'press', 'podcast',
    'newsletter', 'event', 'other'
  ])) then
    v_referral_source := null;
  end if;

  select array_agg(x) into v_hiring_for from (
    select distinct x
    from jsonb_array_elements_text(
      case when jsonb_typeof(v_meta->'hiring_for') = 'array'
           then v_meta->'hiring_for' else '[]'::jsonb end
    ) as t(x)
    where x = any(v_allowed_categories)
    limit 15
  ) s;

  insert into public.profiles (
    id, email, role, full_name,
    signup_country, signup_role_category,
    terms_accepted_at, age_confirmed_at, marketing_opt_in, referral_code
  )
  values (
    new.id,
    new.email,
    (v_meta->>'role')::public.user_role_type,
    coalesce(v_meta->>'full_name', ''),
    v_country,
    v_role_category,
    case when v_terms then now() end,
    case when v_age then now() end,
    (v_meta->>'marketing_opt_in') = 'true',
    v_referral_code
  )
  on conflict (id) do nothing;

  if v_meta->>'role' = 'client' then
    insert into public.clients (
      user_id, full_name, email, company_name, hiring_for, referral_source
    )
    values (
      new.id,
      coalesce(v_meta->>'full_name', ''),
      new.email,
      v_meta->>'company_name',
      v_hiring_for,
      v_referral_source
    )
    on conflict do nothing;
  end if;

  return new;
exception when others then
  raise log 'handle_new_user failed: % %', sqlerrm, sqlstate;
  return new;
end;
$$;

-- Cleanup: the $99/mo messaging subscription is fully retired. 00001 created
-- these columns, 00004 dropped them, 00090 re-added them so a since-removed
-- messaging gate could read them. Today: checkout has no callers (route
-- deleted this step), the webhook branch that wrote them is deleted with it,
-- and no client ever had a subscription (verified live: all three columns
-- entirely null across all 24 clients). stripe_customer_id STAYS — escrow
-- funding uses it.
alter table public.clients
  drop column if exists subscription_status,
  drop column if exists stripe_subscription_id,
  drop column if exists subscription_current_period_end;
