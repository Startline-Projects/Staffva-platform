-- Found by the step-9 adversarial review: 00128's table-wide
-- `grant select ... to authenticated` covers every column added since —
-- including prep_brief (the client's coaching notes about the candidate)
-- and watchdog (the safety review OF the parties). RLS filters rows, not
-- columns, so each party could read those through PostgREST on their own
-- booking row. Replace the table grant with the columns the parties may
-- actually see; every pipeline/brief/watchdog column is service-role only.
-- (Browser code must name columns explicitly on this table from now on —
-- the only existing browser read, InterviewScheduler, already does.)
revoke select on public.interview_bookings from authenticated;
grant select (id, candidate_id, client_id, starts_at, duration_minutes,
              status, rescheduled_from, cancelled_at, cancel_reason,
              client_consented_at, candidate_consented_at, created_at)
  on public.interview_bookings to authenticated;
