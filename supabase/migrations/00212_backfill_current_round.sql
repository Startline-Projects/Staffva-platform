-- 00212: backfill engagement_offers.current_round from the round history.
--
-- 00211 added current_round defaulting to 0, and the negotiate/accept routes
-- now fence every move on it (.eq current_round = the round the caller saw).
-- An offer countered BEFORE the column existed sits at 0 while its history
-- holds real rounds — every later accept, decline, and counter on it would
-- fence-mismatch and 409 forever. Idempotent: only raises the value, never
-- lowers it.
update public.engagement_offers eo
set current_round = sub.max_round
from (
  select offer_id, max(round) as max_round
  from public.offer_counters
  group by offer_id
) sub
where sub.offer_id = eo.id
  and eo.current_round < sub.max_round;
