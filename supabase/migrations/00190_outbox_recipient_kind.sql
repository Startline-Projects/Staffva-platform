-- The outbox must be able to re-check the freeze when it drains.
--
-- sendEmail now requires recipientKind, so every direct send is checked against
-- the candidate-email freeze. Queued mail was the gap: email_outbox stored
-- to_email, email_type and candidate_id but not WHO the recipient is, so the
-- drain could not re-evaluate the freeze at send time. A message enqueued
-- before a freeze began would drain straight through it.
--
-- Backfilled from candidate_id, which is exactly what it has meant so far:
-- every row carrying one is candidate mail. Rows without one are operational
-- (staff), which the freeze allows anyway — so the backfill cannot wrongly
-- release a candidate message, only wrongly hold a staff one, and there are
-- none of those queued.

begin;

alter table public.email_outbox
  add column if not exists recipient_kind text;

update public.email_outbox
   set recipient_kind = case when candidate_id is not null then 'candidate' else 'staff' end
 where recipient_kind is null;

alter table public.email_outbox
  alter column recipient_kind set default 'candidate',
  alter column recipient_kind set not null;

alter table public.email_outbox
  add constraint email_outbox_recipient_kind_valid
  check (recipient_kind in ('candidate', 'reference', 'client', 'staff'));

comment on column public.email_outbox.recipient_kind is
  'Who this message is for. Read by the drain so a queued message is re-checked '
  'against the email freeze at send time, not only at enqueue time.';

commit;
