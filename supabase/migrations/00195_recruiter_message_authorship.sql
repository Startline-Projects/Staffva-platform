-- A staff reply must be attributed to whoever actually wrote it.
--
-- POST /api/recruiter-messages sets
--   recruiterId = role === "recruiter" ? user.id : candidate.assigned_recruiter
-- with sender_role='recruiter'. So when an ADMIN or a RECRUITING_MANAGER
-- answers, the row is stamped with the assigned recruiter's id — and the
-- candidate's thread renders every staff message under that person's name and
-- photo.
--
-- This becomes live the moment anyone answers the nine people waiting. Eight of
-- them have been waiting since April; seven of their eight assigned recruiters
-- have not signed in since then, so in practice the person who answers will be
-- the owner or the manager. Answer Ahmed's 141-day-old message and Ahmed reads a
-- reply signed by Eslam, who did not write it.
--
-- That is a fabricated first-person message attributed to a real, named
-- employee — the exact defect this program has already had to remove once.
--
-- recruiter_id keeps its meaning: the staff member the THREAD belongs to.
-- sender_profile_id is new and means: who typed this.

begin;

alter table public.recruiter_messages
  add column if not exists sender_profile_id uuid references public.profiles(id);

comment on column public.recruiter_messages.sender_profile_id is
  'Who actually wrote a staff-side message. recruiter_id is the THREAD owner and '
  'is set to candidates.assigned_recruiter when an admin or manager replies, so '
  'rendering the assignee as the author would put words in an absent employee''s '
  'mouth. NULL for candidate messages.';

-- The five existing staff messages really were written by the assigned
-- recruiter: assignment matches the thread on all ten threads today.
update public.recruiter_messages
   set sender_profile_id = recruiter_id
 where sender_role = 'recruiter' and sender_profile_id is null;

-- The invariants live in the database, not the route. Every writer of this
-- table uses the service role, which bypasses RLS entirely — so a policy cannot
-- hold these, and the next route to write here will not remember them.
create or replace function public.recruiter_messages_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_assigned text;
begin
  -- read_at means "the recipient opened this". It is never true at insert.
  if new.read_at is not null then
    raise exception 'read_at may not be set on insert';
  end if;

  select c.assigned_recruiter into v_assigned
    from public.candidates c where c.id = new.candidate_id;

  if new.sender_role = 'candidate' then
    if new.sender_profile_id is not null then
      raise exception 'a candidate message has no staff author';
    end if;
    -- A candidate writes to whoever is assigned to them right now.
    -- assigned_recruiter is TEXT holding a profiles.id; compared as text so a
    -- malformed value fails here rather than as a cast error somewhere else.
    if v_assigned is null or new.recruiter_id::text is distinct from v_assigned then
      raise exception 'candidate message must address the currently assigned recruiter';
    end if;

  elsif new.sender_role = 'recruiter' then
    if new.sender_profile_id is null then
      raise exception 'a staff message must name its author (sender_profile_id)';
    end if;

  else
    raise exception 'unknown sender_role: %', new.sender_role;
  end if;

  return new;
end;
$$;

drop trigger if exists recruiter_messages_guard_trg on public.recruiter_messages;
create trigger recruiter_messages_guard_trg
  before insert on public.recruiter_messages
  for each row execute function public.recruiter_messages_guard();

commit;
