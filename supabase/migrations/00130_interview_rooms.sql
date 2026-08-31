-- Step 6 of the interview feature: video rooms. The create-room response from
-- the vendor includes the full join URL; storing it beside room_name saves
-- reconstructing it from config that doesn't exist anywhere else.
alter table public.interview_bookings add column if not exists room_url text;
