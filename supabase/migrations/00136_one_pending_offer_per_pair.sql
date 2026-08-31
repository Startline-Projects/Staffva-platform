-- Found by the step-11 review: send_offer inserted unconditionally, so
-- send → back-button → send again yielded two live identical offers (and
-- accepting each creates its own engagement + contract). The route now
-- refuses duplicates up front; this index is the backstop that also closes
-- the concurrent-send race no app-level select-then-insert can.
create unique index if not exists engagement_offers_pending_key
  on public.engagement_offers (client_id, candidate_id)
  where status in ('sent','viewed');
