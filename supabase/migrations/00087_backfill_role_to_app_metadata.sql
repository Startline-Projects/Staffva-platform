-- Migration 00087 — backfill_role_to_app_metadata
--
-- Roles were stored in raw_user_meta_data, which any authenticated user can
-- rewrite (supabase.auth.updateUser({ data: { role: 'admin' } })) — a
-- self-escalation to admin. Move authorization to raw_app_meta_data, which is
-- admin-only. This one-time backfill copies role + interview_role for every
-- existing user; the || merge preserves existing app_metadata (provider keys),
-- and jsonb_strip_nulls avoids writing a null interview_role. Applied live.
update auth.users
set raw_app_meta_data =
      coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_strip_nulls(jsonb_build_object(
           'role',           raw_user_meta_data->>'role',
           'interview_role', raw_user_meta_data->>'interview_role'
         ))
where raw_user_meta_data ? 'role'
   or raw_user_meta_data ? 'interview_role';
