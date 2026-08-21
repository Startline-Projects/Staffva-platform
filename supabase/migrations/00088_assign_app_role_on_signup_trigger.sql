-- Migration 00088 — assign_app_role_on_signup_trigger
--
-- New self-serve signups get their role written to the tamper-proof
-- app_metadata, but ONLY for candidate/client. Privileged roles
-- (recruiter/admin/recruiting_manager) are never assigned from client signup
-- input — they are set by admins via the service-role admin API, which writes
-- app_metadata directly and is not affected by this whitelist. BEFORE INSERT so
-- the trigger can set the row being created. Applied live.
create or replace function public.assign_app_role_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := new.raw_user_meta_data->>'role';
begin
  if v_role in ('candidate', 'client') then
    new.raw_app_meta_data :=
      coalesce(new.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', v_role);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_app_role_on_signup on auth.users;
create trigger trg_assign_app_role_on_signup
  before insert on auth.users
  for each row execute function public.assign_app_role_on_signup();
