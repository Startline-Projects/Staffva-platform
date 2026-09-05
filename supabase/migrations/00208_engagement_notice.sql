-- 00208 — the termination mechanism the signed contracts promise.
--
-- Section 3 of every generated agreement: "Either party may terminate this
-- Agreement with 14 days' written notice delivered through the StaffVA
-- platform." The platform implemented nothing: a client ended an engagement
-- by instant release with zero notice, and a candidate had no exit at all —
-- the step-18 audit's "first real dispute lands on a legal document
-- describing a procedure that isn't there."
--
-- The notice lives on the engagement row: who gave it, when, and when the
-- engagement therefore ends. Status stays 'active' through the notice period
-- — work and pay continue for the 14 days, which is the entire point of
-- notice — and the completion cron flips it to 'completed' at ends_at, which
-- the existing lock trigger already handles (candidate unlocked when no
-- other active engagement remains).
--
-- No browser grants: notice is given through the API, which verifies the
-- party and quotes the clause it executes.

alter table public.engagements
  add column if not exists notice_given_at timestamptz,
  add column if not exists notice_given_by text
    check (notice_given_by is null or notice_given_by in ('client','candidate')),
  add column if not exists ends_at timestamptz;

-- The three travel together: a notice names its giver and its end date.
alter table public.engagements
  add constraint engagements_notice_complete check (
    (notice_given_at is null and notice_given_by is null and ends_at is null)
    or
    (notice_given_at is not null and notice_given_by is not null and ends_at is not null)
  );
