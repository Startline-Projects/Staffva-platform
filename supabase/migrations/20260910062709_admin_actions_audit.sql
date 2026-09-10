-- Who did what, in the admin panel.
--
-- Before this table, an administrator could ban a candidate, lift a test
-- lockout, take down a review or rule on a money dispute and nothing anywhere
-- recorded that they were the one who did it. `candidate_status_events` has
-- an `actor_id` column, but every one of its 445 rows is null — it was added
-- after the rows it would have described.
--
-- Design notes:
--
--   * Append-only by construction, not by convention. The trigger below
--     refuses UPDATE and DELETE for every role including service_role, so an
--     audit row cannot be quietly rewritten by the same key that wrote it.
--
--   * `actor_id` may be null only for `actor_role = 'system'` (crons, webhook
--     handlers). Anything a person did names the person. The CHECK is the
--     backstop; `recordAdminAction()` in src/lib/adminAudit.ts is the thing
--     that makes it hard to violate.
--
--   * Reads are open to admin and recruiting_manager via is_admin(). There is
--     deliberately no insert policy: writes come from service-role routes,
--     which bypass RLS, so no signed-in user can forge a row.

create table if not exists public.admin_actions (
  id           bigserial primary key,
  actor_id     uuid references auth.users(id) on delete set null,
  actor_role   text        not null,
  action       text        not null,
  subject_type text        not null,
  subject_id   uuid,
  summary      text        not null,
  detail       jsonb,
  created_at   timestamptz not null default now(),

  constraint admin_actions_actor_named
    check (actor_role = 'system' or actor_id is not null)
);

comment on table public.admin_actions is
  'Append-only record of staff decisions in the admin panel. One row per act; never updated, never deleted.';
comment on column public.admin_actions.action is
  'Dotted verb, e.g. candidate.approve, ban.confirm, review.takedown, dispute.resolve, lockout.lift.';
comment on column public.admin_actions.summary is
  'One line a human can read without joining anything.';

create index if not exists admin_actions_created_at_idx on public.admin_actions (created_at desc);
create index if not exists admin_actions_actor_idx      on public.admin_actions (actor_id, created_at desc);
create index if not exists admin_actions_subject_idx    on public.admin_actions (subject_type, subject_id, created_at desc);
create index if not exists admin_actions_action_idx     on public.admin_actions (action, created_at desc);

-- Append-only. A log that the writer can edit is not a log.
create or replace function public.admin_actions_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'admin_actions is append-only (attempted %)', tg_op;
end;
$$;

drop trigger if exists admin_actions_no_update on public.admin_actions;
create trigger admin_actions_no_update
  before update or delete on public.admin_actions
  for each row execute function public.admin_actions_append_only();

alter table public.admin_actions enable row level security;

drop policy if exists admin_actions_staff_read on public.admin_actions;
create policy admin_actions_staff_read
  on public.admin_actions
  for select
  to authenticated
  using ((select public.is_admin()));
