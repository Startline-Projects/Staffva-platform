-- 00182 added ten columns the profile builder writes and granted UPDATE on
-- none of them. Every profile submission would have failed.
--
-- The cause is worth writing down because it will catch the next person too:
-- public.candidates does not have a TABLE-level UPDATE grant for
-- `authenticated`. 00120 replaced it with column-level grants — 36 of them —
-- so a new column is born writable by nobody. `alter table ... add column` does
-- not inherit a grant that does not exist, and nothing fails until a candidate
-- presses Submit and gets a permission error on a form they just spent twenty
-- minutes filling in.
--
-- 00182's `revoke update (...) from anon` was, for the same reason, a no-op:
-- anon never had the grant to lose.

grant update (
  city,
  role_title,
  hours_per_week,
  working_hours,
  payout_currency,
  education,
  certifications,
  languages
) on public.candidates to authenticated;

-- profile_draft and profile_draft_at are deliberately NOT granted. The autosave
-- route writes them under the service role, so the candidate never touches
-- them directly — and a draft column the browser could write is a column the
-- browser could write anything into.

comment on column public.candidates.profile_draft is
  'Autosaved builder state. Written ONLY by /api/candidate/profile-draft under '
  'the service role — authenticated deliberately holds no UPDATE grant here. '
  'Read back to repopulate the form and deleted on submit; no gate reads it.';

-- A standing note for whoever adds the next column to this table.
comment on table public.candidates is
  'UPDATE for `authenticated` is granted COLUMN BY COLUMN (see 00120, 00183). '
  'There is no table-level grant, so a newly added column is writable by nobody '
  'until it is granted explicitly. If a candidate needs to write it, add it to '
  'a grant in the same migration that adds the column.';
