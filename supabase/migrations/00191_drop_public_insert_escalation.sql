-- Privilege escalation: two policies named for service_role were granted to PUBLIC.
--
--   "Service role can insert clients"  ON public.clients  FOR INSERT TO PUBLIC WITH CHECK (true)
--   "Service role can insert profiles" ON public.profiles FOR INSERT TO PUBLIC WITH CHECK (true)
--
-- service_role bypasses RLS entirely, so neither policy grants that role
-- anything. Their only real beneficiaries are anon and authenticated — and
-- because permissive policies OR together, each one completely nullifies the
-- correct rule sitting beside it ("Clients can insert own record",
-- WITH CHECK (auth.uid() = user_id)).
--
-- Confirmed exploitable, not theoretical. Probing as an authenticated approved
-- candidate, an INSERT into public.clients for their own user_id SUCCEEDED —
-- a candidate can promote themselves to a client account. The same probe with
-- another user's id failed only on the unique constraint clients_user_id_key,
-- so any auth user without an existing clients row can be given one by anybody.
--
-- profiles is the more dangerous of the two: is_admin() is
--   select exists (select 1 from profiles where id = auth.uid()
--                  and role in ('admin','recruiting_manager'))
-- so a self-inserted profiles row with role='admin' confers admin across every
-- policy that calls is_admin(). The FK to auth.users stops arbitrary ids, but
-- any real auth user whose profiles row does not yet exist can insert their own
-- with role='admin'. One such user exists right now, and every signup passes
-- through that window.
--
-- Nothing legitimate depends on either policy: profiles rows are created by the
-- SECURITY DEFINER trigger on_auth_user_created -> handle_new_user(), and the
-- one app-side upsert (api/application-queue/submit) uses the service-role
-- client. Both bypass RLS.

begin;

drop policy if exists "Service role can insert clients" on public.clients;
drop policy if exists "Service role can insert profiles" on public.profiles;

commit;
