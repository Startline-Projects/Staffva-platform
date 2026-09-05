-- 00207 — the messages table stops being browser-writable.
--
-- The client-messaging review confirmed the API's gates (approved-candidate
-- initiation, contact-info filter, the bell) exist ONLY in the route — and a
-- live grant check showed authenticated (and anon!) hold INSERT on messages,
-- with "Clients can send messages" checking nothing but ownership. So a
-- signed-in client could insert a row to ANY of the 256 candidates over
-- PostgREST today, no filter, no gate, no bell. The candidate-side reply
-- policy self-references messages and merely happens to fail with 42P17
-- recursion — fail-closed by accident, and the accident goes away the day
-- someone "fixes" the policy.
--
-- The API's service role is the one writer, like recruiter_messages (00194)
-- and candidate_notifications (00202). SELECT policies stay (each party reads
-- own threads); 00205's read_at-only UPDATE path stays.
revoke insert on public.messages from anon, authenticated;
drop policy if exists "Clients can send messages" on public.messages;
drop policy if exists "Candidates can reply to messages" on public.messages;
