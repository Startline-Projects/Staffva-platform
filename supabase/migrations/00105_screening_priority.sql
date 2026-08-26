-- A sortable screening priority, so the admin candidate list can paginate.
--
-- The admin page loads EVERY candidate for a status and then filters, sorts and
-- counts them in the browser. That is why it has no pagination: paginating
-- without moving those three server-side would quietly break the screening-tag
-- tab counters, which are computed from the loaded rows.
--
-- The sort it performs is:
--
--   const order = { Priority: 0, Review: 1, Hold: 2 };
--   (order[a.screening_tag || "Review"] ?? 1) - (order[b.screening_tag || "Review"] ?? 1)
--
-- Note both fallbacks land on 1: a NULL tag becomes "Review" and scores 1, and
-- any unrecognised tag hits `?? 1` and also scores 1. This column reproduces
-- that exactly rather than approximately -- 34 of 254 candidates currently have
-- a NULL tag, so getting the NULL case wrong would visibly reorder the page.
--
-- Generated and stored, so it cannot drift from screening_tag the way a trigger
-- or an application-maintained column would.
alter table public.candidates
  add column if not exists screening_priority smallint
  generated always as (
    case screening_tag
      when 'Priority' then 0
      when 'Hold'     then 2
      else 1
    end
  ) stored;

-- The list's ordering key. created_at is included as a tiebreaker because
-- pagination over a non-deterministic order silently repeats and skips rows
-- between pages -- with only four distinct priorities and thousands of rows,
-- ties are the normal case here, not an edge case.
create index if not exists idx_candidates_screening_priority
  on public.candidates (screening_priority, created_at desc);

-- Backs the per-tag counts, which are now aggregated in the database instead of
-- being derived from a fully-loaded list.
create index if not exists idx_candidates_status_tag
  on public.candidates (admin_status, screening_tag);

analyze public.candidates;
