-- 00209 — the offer status negotiation needs. Its own migration because a
-- freshly added enum value cannot be USED in the transaction that adds it.
alter type public.offer_status_type add value if not exists 'countered';
