"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

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
  lists: Shortlist[];
  savedIds: Set<string>;
  listsFor: (candidateId: string) => string[];
  toggle: (candidateId: string) => Promise<void>;
  setMembership: (candidateId: string, shortlistId: string, on: boolean) => Promise<void>;
  createList: (name: string) => Promise<{ ok: boolean; error?: string }>;
  error: string;
}

const ShortlistsCtx = createContext<Ctx | null>(null);

const DISABLED: Ctx = {
  ready: true,
  enabled: false,
  lists: [],
  savedIds: new Set(),
  listsFor: () => [],
  toggle: async () => {},
  setMembership: async () => {},
  createList: async () => ({ ok: false }),
  error: "",
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
  const [lists, setLists] = useState<Shortlist[]>([]);
  // candidate id → the list ids holding them. A candidate can sit in several.
  const [members, setMembers] = useState<Record<string, string[]>>({});
  const [error, setError] = useState("");

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
      setError("");
    } catch {
      // The heart hides rather than lying about what is saved.
      setError("Couldn't load your lists.");
    } finally {
      setReady(true);
    }
  }, [enabled]);

  useEffect(() => {
    load();
  }, [load]);

  const listsFor = useCallback((candidateId: string) => members[candidateId] || [], [members]);

  const savedIds = new Set(Object.keys(members).filter((id) => (members[id] || []).length > 0));

  const setMembership = useCallback(
    async (candidateId: string, shortlistId: string, on: boolean) => {
      const before = members[candidateId] || [];
      const after = on
        ? Array.from(new Set([...before, shortlistId]))
        : before.filter((id) => id !== shortlistId);
      // Optimistic, because a heart that waits a round trip to fill in feels
      // broken; the catch below puts it back if the write did not land.
      setMembers((m) => ({ ...m, [candidateId]: after }));
      setLists((ls) => ls.map((l) => (l.id === shortlistId ? { ...l, count: Math.max(0, l.count + (on ? 1 : -1)) } : l)));
      try {
        const res = await fetch("/api/client/shortlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: on ? "add" : "remove", candidateId, shortlistId }),
        });
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        setMembers((m) => ({ ...m, [candidateId]: before }));
        setLists((ls) => ls.map((l) => (l.id === shortlistId ? { ...l, count: Math.max(0, l.count + (on ? -1 : 1)) } : l)));
        setError("That didn't save. Try again.");
      }
    },
    [members]
  );

  const toggle = useCallback(
    async (candidateId: string) => {
      const current = members[candidateId] || [];
      if (current.length > 0) {
        // Un-hearting clears every list they are in, which is what the filled
        // heart claims. Removing from only the default would leave the heart
        // filled by another list and read as a failed click.
        const before = current;
        setMembers((m) => ({ ...m, [candidateId]: [] }));
        setLists((ls) => ls.map((l) => (before.includes(l.id) ? { ...l, count: Math.max(0, l.count - 1) } : l)));
        try {
          for (const id of before) {
            const res = await fetch("/api/client/shortlists", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "remove", candidateId, shortlistId: id }),
            });
            if (!res.ok) throw new Error(String(res.status));
          }
        } catch {
          setMembers((m) => ({ ...m, [candidateId]: before }));
          setLists((ls) => ls.map((l) => (before.includes(l.id) ? { ...l, count: l.count + 1 } : l)));
          setError("That didn't save. Try again.");
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
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        const listId: string = data.shortlistId;
        setMembers((m) => ({ ...m, [candidateId]: [listId] }));
        setLists((ls) => {
          const hit = ls.find((l) => l.id === listId);
          if (hit) return ls.map((l) => (l.id === listId ? { ...l, count: l.count + 1 } : l));
          // The default list was created by that very call.
          return [{ id: listId, name: "Saved", isDefault: true, count: 1 }, ...ls];
        });
        setError("");
      } catch {
        setError("That didn't save. Try again.");
      }
    },
    [members]
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
      return { ok: true };
    } catch {
      return { ok: false, error: "Couldn't create that list." };
    }
  }, []);

  return (
    <ShortlistsCtx.Provider
      value={{ ready, enabled, lists, savedIds, listsFor, toggle, setMembership, createList, error }}
    >
      {children}
    </ShortlistsCtx.Provider>
  );
}
