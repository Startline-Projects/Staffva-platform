-- Interface-audit fix, part 1 of 2 (separate migration because Postgres
-- cannot add an enum value and use it in the same transaction): payment
-- periods need a state that says the truth — created but not yet paid.
alter type public.period_status_type add value if not exists 'pending' before 'funded';
