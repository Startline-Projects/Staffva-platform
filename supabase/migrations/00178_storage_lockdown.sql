-- The profile media layer, before anything is built on top of it.
--
-- Three things were found while specifying the profile rebuild, all live:
--
-- 1. profile-photos accepted INSERT and UPDATE from `public` — which includes
--    anon — gated on nothing but the bucket name. Anyone on the internet could
--    overwrite any of the 71 stored photos with any image, and the bucket is
--    public, so the replacement renders on that candidate's profile.
-- 2. video-intros has RLS on and ZERO policies, so every upload has failed
--    since the bucket was created. That is why 0 of 256 candidates have a video
--    intro: the feature was never capable of working.
-- 3. resumes and portfolio grant SELECT to any authenticated user with no
--    ownership check, so any signed-in candidate could read all 74 resumes and
--    every other candidate's portfolio.
--
-- Every object in these buckets is stored under `<candidate_id>/<file>`, so
-- ownership is checkable from the path. Verified across all 323 objects: the
-- first segment is a UUID in every single one.

-- A candidate's own id, for path scoping. SECURITY DEFINER so a policy can use
-- it without granting the caller read access to the whole candidates table.
create or replace function public.current_candidate_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.candidates c where c.user_id = (select auth.uid()) limit 1;
$$;

revoke all on function public.current_candidate_id() from public;
grant execute on function public.current_candidate_id() to authenticated;

comment on function public.current_candidate_id() is
  'The calling user''s candidate id, or NULL. Used by storage policies to scope '
  'a bucket path prefix to its owner. NULL is safe: `x = NULL` is NULL, which '
  'fails the policy rather than passing it.';

-- ── profile-photos ────────────────────────────────────────────────────────
-- Public bucket, so SELECT stays open — a profile photo is meant to be seen.
-- Writes become the owner's only.
-- BOTH name sets, and the reason is worth recording. The live database had
-- these policies under dashboard-renamed titles ("Anyone can upload to
-- profile-photos"); the migration tree creates them in 00006 as "Candidates
-- can upload profile photos" and "Candidates can update own profile photos" —
-- the latter having no ownership check at all despite the word "own".
--
-- Dropping only the live names fixed only the live database. Replayed into a
-- fresh one, 00006's unscoped pair would survive alongside the owner-scoped
-- pair below, and because storage policies are permissive and OR together, the
-- unscoped ones win: any authenticated candidate could overwrite any other
-- candidate's photo. The vulnerability would come back on the next rebuild.
drop policy if exists "Anyone can upload to profile-photos"       on storage.objects;
drop policy if exists "Anyone can update profile-photos"          on storage.objects;
drop policy if exists "Candidates can upload profile photos"      on storage.objects;
drop policy if exists "Candidates can update own profile photos"  on storage.objects;

create policy "Owners write their own profile photo"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and (string_to_array(name, '/'))[1] = public.current_candidate_id()::text
  );

create policy "Owners replace their own profile photo"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'profile-photos'
    and (string_to_array(name, '/'))[1] = public.current_candidate_id()::text
  )
  with check (
    bucket_id = 'profile-photos'
    and (string_to_array(name, '/'))[1] = public.current_candidate_id()::text
  );

-- ── resumes ───────────────────────────────────────────────────────────────
-- A CV is the most identifying document a candidate gives us. It was readable
-- by every signed-in account on the platform.
drop policy if exists "Authenticated users can read resumes" on storage.objects;
drop policy if exists "Candidates can upload resumes"        on storage.objects;

create policy "Owners and staff read resumes"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'resumes'
    and (
      (string_to_array(name, '/'))[1] = public.current_candidate_id()::text
      or public.is_admin()
    )
  );

create policy "Owners upload their own resume"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'resumes'
    and (string_to_array(name, '/'))[1] = public.current_candidate_id()::text
  );

-- ── portfolio ─────────────────────────────────────────────────────────────
drop policy if exists "Authenticated users can read portfolio" on storage.objects;
drop policy if exists "Candidates can upload portfolio"        on storage.objects;

create policy "Owners and staff read portfolio"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'portfolio'
    and (
      (string_to_array(name, '/'))[1] = public.current_candidate_id()::text
      or public.is_admin()
    )
  );

create policy "Owners upload their own portfolio"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'portfolio'
    and (string_to_array(name, '/'))[1] = public.current_candidate_id()::text
  );

-- ── video-intros ──────────────────────────────────────────────────────────
-- The bucket that has never accepted a byte. A face video is the most personal
-- artifact in the product, so it is owner-write, owner-and-staff read, and it
-- is NOT made public — clients see it through a signed URL, never a guessable
-- one.
create policy "Owners upload their own video intro"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'video-intros'
    and (string_to_array(name, '/'))[1] = public.current_candidate_id()::text
  );

create policy "Owners replace their own video intro"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'video-intros'
    and (string_to_array(name, '/'))[1] = public.current_candidate_id()::text
  )
  with check (
    bucket_id = 'video-intros'
    and (string_to_array(name, '/'))[1] = public.current_candidate_id()::text
  );

create policy "Owners and staff read video intros"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'video-intros'
    and (
      (string_to_array(name, '/'))[1] = public.current_candidate_id()::text
      or public.is_admin()
    )
  );

-- Size and type limits. A 75-second capture has no business being 200MB, and
-- the bucket must not become a general file drop.
update storage.buckets
   set file_size_limit = 60 * 1024 * 1024,
       allowed_mime_types = array['video/webm', 'video/mp4']
 where id = 'video-intros';

update storage.buckets
   set file_size_limit = 8 * 1024 * 1024,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'profile-photos';
