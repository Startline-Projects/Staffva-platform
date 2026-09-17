-- admin_recording_index
--
-- What is actually in storage for the recordings library, per candidate and
-- per attempt, in one query.
--
-- The library at /admin/video-reviews files recordings into a folder per
-- person, then English test / Interview 1 / Interview 2, then one folder per
-- attempt. "Does this folder exist" has to be answered from the bucket, not
-- from proctor_sessions: the footage is deleted on a schedule (at once when a
-- session reviews clear, seven days after a human decides a flagged one), a
-- deletion can half-fail, and the counters already drift — one live session
-- says chunk_count 14 with 15 objects stored. Interview 1's answer audio has
-- no table row at all; the bucket is the only record that it exists.
--
-- PostgREST does not expose the storage schema and storage.list() is one call
-- per prefix, which is one call per attempt per candidate for an index page.
--
-- Layouts read here (first path segment is always the candidate id):
--   proctor-recordings/<candidate>/<session_kind>/<session_id>/video/chunk-NNNNN.webm
--   proctor-recordings/<candidate>/<session_kind>/<session_id>/frames/frame-NNNNN.jpg
--   voice-recordings/<candidate>/interview1/<ai_interview_id>/<question>.webm
--
-- voice-recordings also holds each candidate's public voice samples
-- (<candidate>/oral-reading-*.webm, self-intro-*.webm). Those are profile
-- content, not assessment evidence, and are deliberately not returned.

create or replace function public.admin_recording_index(p_candidate uuid default null)
returns table (
  candidate_id      uuid,
  bucket            text,
  kind              text,
  ref_id            uuid,
  video_chunks      integer,
  frames            integer,
  audio_files       integer,
  empty_audio_files integer,
  bytes             bigint,
  newest            timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select split_part(o.name, '/', 1)::uuid,
         o.bucket_id,
         split_part(o.name, '/', 2),
         split_part(o.name, '/', 3)::uuid,
         (count(*) filter (where split_part(o.name, '/', 4) = 'video'))::integer,
         (count(*) filter (where split_part(o.name, '/', 4) = 'frames'))::integer,
         (count(*) filter (where o.bucket_id = 'voice-recordings'))::integer,
         -- A zero-byte answer is a recording that captured nothing. It is
         -- counted apart so a folder of silence never reads as evidence.
         (count(*) filter (where o.bucket_id = 'voice-recordings'
                             and coalesce((o.metadata->>'size')::bigint, 0) = 0))::integer,
         coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint,
         max(o.created_at)
  from storage.objects o
  where (
          o.bucket_id = 'proctor-recordings'
          or (o.bucket_id = 'voice-recordings' and split_part(o.name, '/', 2) = 'interview1')
        )
    -- Both casts above would abort the whole call on one malformed path, so
    -- anything that is not <uuid>/<kind>/<uuid>/… is left out rather than
    -- allowed to take the index down with it.
    and split_part(o.name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and split_part(o.name, '/', 3) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (p_candidate is null or o.name like p_candidate::text || '/%')
  group by 1, 2, 3, 4
  -- PostgREST caps an RPC at max-rows (1000) like any other read, so the
  -- caller pages with range(). Paging an unordered set can repeat or skip
  -- rows between pages; the group key is unique, so ordering by it cannot.
  order by 1, 2, 3, 4
$$;

comment on function public.admin_recording_index(uuid) is
  'Storage ground truth for the admin recordings library: one row per candidate/attempt folder with counts. Service role only.';

-- Supabase's default privileges hand EXECUTE on every new public function to
-- anon and authenticated. This one is SECURITY DEFINER over storage.objects,
-- so left alone it would let any signed-in candidate enumerate who has been
-- recorded, and how much.
revoke all on function public.admin_recording_index(uuid) from public;
revoke all on function public.admin_recording_index(uuid) from anon;
revoke all on function public.admin_recording_index(uuid) from authenticated;
grant execute on function public.admin_recording_index(uuid) to service_role;
