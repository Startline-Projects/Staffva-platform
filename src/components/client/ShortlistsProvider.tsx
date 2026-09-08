"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * One fetch of the client's shortlists for a whole page of results.
 *
 * Every card needs the same two answers — which lists exist, and is THIS
 * person in one of them — so a heart that asked for itself would fire 24
 * identical requests per page. The provider asks once and hands both down.
 *
 * `enabled` is false for signed-out visitors and for non-clients (candidates
 * and recruiters browse the same page). When it is false nothing is fetched
 * and no heart renders: a save control that 401s on click is worse than no
 * save control.
 *
 * `loadFailed` is the other half of that rule, and it is not the same as
 * "empty". If the fetch fails, an empty `members` map would render every
 * heart unfilled and tell a client with four lists that they have none — a
 * confident wrong answer. The heart hides instead.
 *
 * Every mutation reads its previous state inside the functional updater
 * rather than from a captured `members`. Two fast clicks on the same heart
 * both saw `length === 0` in the closure version, both took the add path,
 * and both incremented the list count for one membership.
 */

export interface Shortlist {
  id: string;
  name: string;
  isDefault: boolean;
  count: number;
}

interface Ctx {
  ready: boolean;
  enabled: boolean;
  loadFailed: boolean;
  lists: Shortlist[];
  listsFor: (candidateId: string) => string[];
  toggle: (candidateId: string) => Promise<void>;
  setMembership: (candidateId: string, shortlistId: string, on: boolean) => Promise<void>;
  createList: (name: string) => Promise<{ ok: boolean; id?: string; error?: string }>;
  error: string;
  clearError: () => void;
}

const ShortlistsCtx = createContext<Ctx | null>(null);

const DISABLED: Ctx = {
  ready: true,
  enabled: false,
  loadFailed: false,
  lists: [],
  listsFor: () => [],
  toggle: async () => {},
  setMembership: async () => {},
  createList: async () => ({ ok: false }),
  error: "",
  clearError: () => {},
};

export function useShortlists(): Ctx {
  return useContext(ShortlistsCtx) ?? DISABLED;
}

export default function ShortlistsProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [lists, setLists] = useState<Shortlist[]>([]);
  // candidate id → the list ids holding them. A candidate can sit in several.
  const [members, setMembers] = useState<Record<string, string[]>>({});
  const [error, setError] = useState("");
  // Set when an optimistic update may have half-landed; the next load call
  // replaces guesses with the server's answer.
  const resyncing = useRef(false);
  // A mirror of `members`, so a handler can read the CURRENT membership
  // without depending on a closure that may be a render behind. The bug this
  // prevents: two fast clicks on one heart both reading `[]` from a stale
  // closure, both taking the add path, and both incrementing the count.
  //
  // Synced in an effect, not during render: a render that React discards must
  // not leave the ref claiming a state that was never committed. Handlers run
  // after commit, and the in-flight paths below update the ref themselves.
  const membersRef = useRef<Record<string, string[]>>({});
  useEffect(() => {
    membersRef.current = members;
  }, [members]);

  const load = useCallback(async () => {
    if (!enabled) {
      setReady(true);
      return;
    }
    try {
      const res = await fetch("/api/client/shortlists?withMembers=1");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setLists(data.shortlists || []);
      setMembers(data.members || {});
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setReady(true);
      resyncing.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    load();
  }, [load]);

  const listsFor = useCallback((candidateId: string) => members[candidateId] || [], [members]);

  /**
   * Anything that went partly wrong is re-read rather than guessed at. The
   * removal path in particular issues one request per list a candidate is in,
   * so a failure on the second of three leaves the server holding a state no
   * local rollback can reconstruct.
   */
  const resync = useCallback(
    (message: string) => {
      setError(message);
      if (!resyncing.current) {
        resyncing.current = true;
        load();
      }
    },
    [load]
  );

  const bumpCount = useCallback((listId: string, delta: number) => {
    setLists((ls) => ls.map((l) => (l.id === listId ? { ...l, count: Math.max(0, l.count + delta) } : l)));
  }, []);

  const setMembership = useCallback(
    async (candidateId: string, shortlistId: string, on: boolean) => {
      let changed = false;
      // Optimistic, because a heart that waits a round trip to fill in feels
      // broken. The updater decides from CURRENT state whether anything
      // actually changes, so a repeated click cannot double-count.
      setMembers((m) => {
        const before = m[candidateId] || [];
        if (on === before.includes(shortlistId)) return m;
        changed = true;
        return {
          ...m,
          [candidateId]: on ? [...before, shortlistId] : before.filter((id) => id !== shortlistId),
        };
      });
      if (!changed) return;
      bumpCount(shortlistId, on ? 1 : -1);

      try {
        const res = await fetch("/api/client/shortlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: on ? "add" : "remove", candidateId, shortlistId }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || String(res.status));
        }
        setError("");
      } catch (err) {
        resync(err instanceof Error && err.message.length < 120 ? err.message : "That didn't save.");
      }
    },
    [bumpCount, resync]
  );

  const toggle = useCallback(
    async (candidateId: string) => {
      const before = membersRef.current[candidateId] || [];
      if (before.length > 0) {
        // Un-hearting clears every list they are in, which is what the filled
        // heart claims. Removing from only the default would leave the heart
        // filled by another list and read as a failed click.
        //
        // A second click while this is in flight reads [] from the ref and
        // takes the add path instead of firing the removals twice.
        setMembers((m) => ({ ...m, [candidateId]: [] }));
        membersRef.current = { ...membersRef.current, [candidateId]: [] };
        for (const id of before) bumpCount(id, -1);
        try {
          for (const id of before) {
            const res = await fetch("/api/client/shortlists", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "remove", candidateId, shortlistId: id }),
            });
            if (!res.ok) throw new Error(String(res.status));
          }
          setError("");
        } catch {
          // Some removals may already have committed, so the local state is
          // no longer reconstructible — ask the server.
          resync("That didn't save. Refreshing your lists…");
        }
        return;
      }

      // First save with no list chosen: the server picks (or creates) the
      // default and tells us which one it used, so the count lands on the
      // right row without a second round trip.
      try {
        const res = await fetch("/api/client/shortlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "add", candidateId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || String(res.status));
        const listId: string = data.shortlistId;
        let added = false;
        setMembers((m) => {
          const cur = m[candidateId] || [];
          if (cur.includes(listId)) return m;
          added = true;
          return { ...m, [candidateId]: [...cur, listId] };
        });
        if (added) {
          setLists((ls) => {
            const hit = ls.find((l) => l.id === listId);
            if (hit) return ls.map((l) => (l.id === listId ? { ...l, count: l.count + 1 } : l));
            // The default list was created by that very call. Its name is
            // read back on the next load; "Saved" is the name the server
            // tries first.
            return [{ id: listId, name: data.shortlistName || "Saved", isDefault: true, count: 1 }, ...ls];
          });
        }
        setError("");
      } catch (err) {
        setError(err instanceof Error && err.message.length < 120 ? err.message : "That didn't save.");
      }
    },
    [bumpCount, resync]
  );

  const createList = useCallback(async (name: string) => {
    try {
      const res = await fetch("/api/client/shortlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", name }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data?.error || "Couldn't create that list." };
      setLists((ls) => [...ls, { id: data.shortlist.id, name: data.shortlist.name, isDefault: false, count: 0 }]);
      return { ok: true, id: data.shortlist.id as string };
    } catch {
      return { ok: false, error: "Couldn't create that list." };
    }
  }, []);

  const clearError = useCallback(() => setError(""), []);

  // Memoized: without it every heart on the page re-renders on any state
  // change here, including ones that concern a single card.
  const value = useMemo<Ctx>(
    () => ({
      ready,
      enabled,
      loadFailed,
      lists,
      listsFor,
      toggle,
      setMembership,
      createList,
      error,
      clearError,
    }),
    [ready, enabled, loadFailed, lists, listsFor, toggle, setMembership, createList, error, clearError]
  );

  return <ShortlistsCtx.Provider value={value}>{children}</ShortlistsCtx.Provider>;
}
