-- P2 review fix: without an attempt cap, four permanently-failing sessions
-- (one oversized frame is enough) occupy the whole review queue forever and
-- proctoring silently dies platform-wide. After 5 failed reviews a session
-- fails toward FLAG — evidence preserved, human summoned — never toward
-- clear and never toward an eternal retry.
alter table public.proctor_sessions
  add column if not exists review_attempts integer not null default 0;
