-- 00216: MFA backup codes (Atlas + GAMEPLAN specify them; today a lost
-- authenticator is total lockout — password reset itself challenges TOTP,
-- and support has no tool either).
--
-- Only HASHES are stored (sha256 of the code); plaintext exists once, in the
-- generation response. Service-role only: no grants, no policies — the
-- generate and recover API routes are the only readers/writers, and the
-- recover route is reachable by the stuck aal1 half-session on purpose
-- (middleware exempts /api; the route does its own auth + rate limiting).
create table if not exists public.mfa_backup_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  unique (user_id, code_hash)
);

create index if not exists idx_mfa_backup_codes_user on public.mfa_backup_codes(user_id);

alter table public.mfa_backup_codes enable row level security;
revoke all on public.mfa_backup_codes from anon, authenticated;
