-- The video intro, made recordable.
--
-- Zero of 256 candidates have one. That is not low uptake: the video-intros
-- bucket had RLS on and no policies at all, so every upload since the feature
-- shipped has failed. 00178 gave it policies; this migration gives it the
-- state the prompted recording needs.
--
-- The take counter is the part worth explaining. Atlas increments its retake
-- counter in the RETAKE BUTTON HANDLER, before a recording exists, and then
-- renders "No retakes left". Ported literally onto a Philippine connection,
-- a candidate whose upload dropped at 80% would have spent a take on a file
-- that never reached us — and their second failure would end their
-- application. So takes are counted server-side, on FINALIZE, against a file
-- that is durably stored. A take that did not save did not happen.

alter table public.candidates
  add column if not exists video_intro_takes_used    integer not null default 0,
  add column if not exists video_intro_takes_allowed integer not null default 2,
  add column if not exists video_intro_duration_ms   integer,
  -- Where each prompt actually began, measured from the recorder's own clock
  -- rather than from a setTimeout schedule: [{index, prompt, start_ms}].
  -- Camera warm-up is 1-3s on a low-end Android and a backgrounded tab
  -- throttles timers while the encoder keeps real time, so wall-clock
  -- section boundaries drift out of the video they claim to describe.
  add column if not exists video_intro_sections      jsonb;

alter table public.candidates
  drop constraint if exists candidates_video_intro_takes_check;
alter table public.candidates
  add constraint candidates_video_intro_takes_check
  check (video_intro_takes_used >= 0 and video_intro_takes_used <= 10)
  not valid;

comment on column public.candidates.video_intro_takes_used is
  'Incremented ONLY by consume_video_take(), inside finalize, against a file '
  'already written to storage. An upload that fails costs nothing — the '
  'candidate is told so, and the copy says "a take only counts once it''s '
  'saved".';

-- The columns are server-written. The candidate must not be able to grant
-- themselves more takes.
revoke update (
  video_intro_takes_used, video_intro_takes_allowed,
  video_intro_duration_ms, video_intro_sections
) on public.candidates from authenticated, anon;

-- One place that spends a take, so there is one place to read when somebody
-- asks why a candidate ran out.
create or replace function public.consume_video_take(
  p_candidate_id uuid,
  p_url text,
  p_duration_ms integer,
  p_sections jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  used integer;
  allowed integer;
begin
  select video_intro_takes_used, video_intro_takes_allowed
    into used, allowed
    from public.candidates
   where id = p_candidate_id
   for update;

  if used is null then
    raise exception 'No such candidate';
  end if;
  if used >= allowed then
    raise exception 'No takes remaining';
  end if;

  update public.candidates
     set video_intro_takes_used  = used + 1,
         video_intro_url         = p_url,
         video_intro_duration_ms = p_duration_ms,
         video_intro_sections    = p_sections,
         video_intro_status      = 'pending_review',
         video_intro_submitted_at = now(),
         -- A fresh submission clears a previous revision request; otherwise a
         -- candidate who was asked to re-record stays flagged forever.
         video_intro_revision_requested = false
   where id = p_candidate_id;

  return allowed - (used + 1);
end;
$$;

revoke all on function public.consume_video_take(uuid, text, integer, jsonb) from public, anon, authenticated;

comment on function public.consume_video_take(uuid, text, integer, jsonb) is
  'Spends one take and publishes the recording, atomically, under SELECT FOR '
  'UPDATE. Service-role only — called from the finalize route after the '
  'concatenated file is durably in storage.';

-- An admin asking for a re-record gives the takes back. Without this, the
-- revision request is an instruction the candidate cannot follow.
create or replace function public.reset_video_takes(p_candidate_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin may reset video takes';
  end if;
  update public.candidates
     set video_intro_takes_used = 0
   where id = p_candidate_id;
end;
$$;

revoke all on function public.reset_video_takes(uuid) from public, anon;
grant execute on function public.reset_video_takes(uuid) to authenticated;
