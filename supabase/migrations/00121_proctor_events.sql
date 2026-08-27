-- One event stream for assessment integrity, written only by the server.
--
-- This replaces a system that was broken in a way nobody noticed for months:
-- EnglishTest.tsx wrote test_events from the BROWSER with
-- .insert(...).select("id").single() against a table whose only RLS policy was
-- INSERT — PostgREST rejected the read-back, the whole request failed, the
-- error was never checked, and the table has 0 rows against 113 completed
-- tests. Meanwhile a second, cruder logger (FocusEnforcement -> cheat_log)
-- worked but recorded only 'mouse_leave', with real tab switches routed
-- through the same handler. Every number the anticheat flags depend on has
-- been zero in production forever.
--
-- Design rules learned from that failure, all enforced here:
--   * The browser NEVER touches this table. RLS is enabled with zero policies
--     and no grants — exactly the shape of cheat_log, which is the one that
--     worked. Writes go through /api/proctor/events with the service role.
--   * event_type is TEXT with a CHECK, not an enum: the old client wrote
--     'mobile_device', which was not in the enum, and the insert died
--     silently. A CHECK rejects loudly at the route, where it is handled.
--   * Append-only. The old design UPDATEd the leave row with its return time,
--     which needed the id round-trip that broke everything. Here a return is
--     its own row, paired to its leave by client_event_id.
--   * Two clocks, provenance explicit: received_at is the server's and is
--     authoritative; `at` is the client's claim, advisory only.
create table public.proctor_events (
  id               uuid primary key default gen_random_uuid(),
  candidate_id     uuid not null references public.candidates(id) on delete cascade,
  session_kind     text not null check (session_kind in ('english_test', 'ai_interview')),
  event_type       text not null check (event_type in (
    'mouse_leave', 'tab_switch', 'fullscreen_exit',  -- leave events (countable)
    'focus_return',                                  -- paired to a leave by client_event_id
    'paste_attempt', 'mobile_device',                -- singletons
    'warning_shown', 'test_started', 'test_submitted'
  )),
  question_number  integer check (question_number between 0 and 500),
  client_event_id  uuid,
  duration_ms      integer check (duration_ms between 0 and 3600000),
  at               timestamptz,
  received_at      timestamptz not null default now()
);

create index idx_proctor_events_candidate
  on public.proctor_events (candidate_id, session_kind, received_at);
create index idx_proctor_events_pairing
  on public.proctor_events (client_event_id) where client_event_id is not null;

alter table public.proctor_events enable row level security;
revoke all on public.proctor_events from public, anon, authenticated;

-- test_events and cheat_log are left in place as history (0 and 250 rows).
-- Nothing writes either of them after this ships.
