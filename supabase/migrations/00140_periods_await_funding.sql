-- Interface-audit fix, part 2: new payment periods defaulted to 'funded' —
-- so the client dashboard showed a green "Funded — Period Active" chip on
-- periods no money had ever backed. Only the Stripe webhook may say funded
-- (it stamps funded_at). Default flips to 'pending', and every existing
-- period claiming 'funded' with no funded_at (all six — none were ever
-- paid; the escrow charge route has no UI caller yet) is corrected.
alter table public.payment_periods alter column status set default 'pending';

update public.payment_periods
   set status = 'pending'
 where status = 'funded'
   and funded_at is null;
