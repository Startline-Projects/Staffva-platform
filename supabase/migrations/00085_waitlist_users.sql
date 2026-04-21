-- Waitlist signups collected while the public site is in maintenance mode.
create table if not exists public.waitlist_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text not null,
  country text not null,
  user_type text not null check (user_type in ('employee', 'employer')),
  position text,
  company_name text,
  hiring_needs text,
  created_at timestamptz not null default now()
);

-- If the table already exists (e.g. created before this column was added), add the column safely.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'waitlist_users'
      and column_name  = 'phone'
  ) then
    alter table public.waitlist_users add column phone text;
  end if;
end $$;

create index if not exists waitlist_users_created_at_idx
  on public.waitlist_users (created_at desc);

create index if not exists waitlist_users_email_idx
  on public.waitlist_users (email);

alter table public.waitlist_users enable row level security;

-- Anonymous visitors on the maintenance page must be able to insert.
drop policy if exists "waitlist_users insert anon" on public.waitlist_users;
create policy "waitlist_users insert anon"
  on public.waitlist_users
  for insert
  to anon, authenticated
  with check (true);

-- Only service_role (admin/back-office) can read.
drop policy if exists "waitlist_users select service_role" on public.waitlist_users;
create policy "waitlist_users select service_role"
  on public.waitlist_users
  for select
  to service_role
  using (true);
