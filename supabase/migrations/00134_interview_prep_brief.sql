-- Step 9 of the interview feature: the client's prep brief, generated once
-- per booking on first view and cached here. Null = not generated yet.
alter table public.interview_bookings
  add column if not exists prep_brief jsonb;
