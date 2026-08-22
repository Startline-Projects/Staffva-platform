-- Migration 00091 — restore_admin_status_enum_and_apply_missing_schema
--
-- The live database had ZERO recorded migrations: the schema was applied
-- ad-hoc, and several repo migrations were never run. This migration
-- reconciles the database with the code. Applied live via the Supabase tooling.
--
-- PART 1 — admin_status_type enum
-- Migration 00079 rebuilt the enum keeping only "the 6 values the application
-- actually uses". That premise was wrong: 00019 had explicitly added
-- 'duplicate_blocked' and 00040 'changes_requested' as admin_status values, and
-- application code still writes five values that are not members. Every one of
-- those UPDATEs failed with "invalid input value for enum", silently breaking:
--   revision_required  -> recruiter/revisions, admin/candidates/review
--   duplicate_blocked  -> admin/identity duplicate blocking
--   changes_requested  -> admin/profile-review (request changes)
--   under_review       -> admin/profile-review (candidate resubmit)
--   deactivated        -> admin/pending-bans (deactivate candidate)
-- ADD VALUE is additive and cannot invalidate existing rows.
alter type admin_status_type add value if not exists 'revision_required';
alter type admin_status_type add value if not exists 'duplicate_blocked';
alter type admin_status_type add value if not exists 'changes_requested';
alter type admin_status_type add value if not exists 'under_review';
alter type admin_status_type add value if not exists 'deactivated';

-- PART 2 — apply migrations 00050 / 00051 / 00055 / 00056, which exist in the
-- repo but were never applied to the live database, plus the photo-review
-- columns that no migration ever defined (code-only drift).

-- 00050 — candidate ban / moderation flow
alter table candidates add column if not exists ban_pending_review boolean not null default false;
alter table candidates add column if not exists ban_requested_by uuid references profiles(id) on delete set null;
alter table candidates add column if not exists ban_requested_at timestamptz;
alter table candidates add column if not exists ban_reason text;
create index if not exists idx_candidates_ban_pending on candidates(ban_pending_review) where ban_pending_review = true;

-- 00051 — ID verification manual review
alter table candidates add column if not exists id_verification_review_note text;
alter table candidates add column if not exists id_verification_reviewed_by uuid references profiles(id) on delete set null;
alter table candidates add column if not exists id_verification_reviewed_at timestamptz;

-- 00055 — video intro revision flag + recruiter targets
alter table candidates add column if not exists video_intro_revision_requested boolean not null default false;
alter table profiles add column if not exists daily_interview_target integer not null default 14;
alter table profiles add column if not exists recruiter_type text not null default 'full_time';
do $$ begin
  alter table profiles add constraint chk_recruiter_type check (recruiter_type in ('full_time','part_time'));
exception when duplicate_object then null;
end $$;

-- 00056 — webhook failure monitoring (read by admin/metrics)
create table if not exists webhook_failures (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  stripe_event_id text,
  error_message text,
  created_at timestamptz not null default now(),
  resolved boolean not null default false
);
create index if not exists idx_webhook_failures_unresolved on webhook_failures (resolved) where resolved = false;
alter table webhook_failures enable row level security;
do $$ begin
  create policy "Service role full access on webhook_failures"
    on webhook_failures for all using (auth.role() = 'service_role');
exception when duplicate_object then null;
end $$;

-- Photo re-review flow — referenced by api/candidate/update-photo and
-- api/admin/photo-review but never defined by any migration.
alter table candidates add column if not exists pending_photo_url text;
alter table candidates add column if not exists photo_pending_review boolean not null default false;
