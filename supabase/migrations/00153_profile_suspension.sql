-- A real suspension marker. Review caught the sign-in page reading
-- profiles.is_active for its "suspended" screen — but that column is
-- 00063's recruiter soft-deactivation flag ("exclude from the reassignment
-- dropdown"), so a recruiter taken out of rotation would have been told
-- their account was suspended pending review. Suspension gets its own
-- column; nothing writes it yet (admin tooling comes with the trust
-- engine), so nobody can be suspended by accident.

alter table public.profiles
  add column if not exists suspended_at timestamptz;
