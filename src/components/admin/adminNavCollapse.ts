/**
 * Which rail groups the admin has collapsed, as an external store.
 *
 * This is `localStorage`, which is exactly what `useSyncExternalStore` is
 * for. Reading it in an effect and calling `setCollapsed` would be a
 * cascading render (and the lint rule that catches it is right); reading it
 * in a `useState` initialiser would render different markup on the server
 * than on the client and break hydration. The store answers `EMPTY` for the
 * server snapshot and the real value once hydrated, which is the one shape
 * that is correct in both passes.
 *
 * The snapshot is cached at module scope because `useSyncExternalStore`
 * compares snapshots by identity — returning a fresh array each call would
 * loop forever.
 */

const KEY = "staffva.admin.nav.collapsed";
const EMPTY: readonly string[] = Object.freeze([]);

let cache: readonly string[] | null = null;
const listeners = new Set<() => void>();

function read(): readonly string[] {
  // Every access is guarded: a browser set to block site data throws on the
  // property itself, not just on the call.
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return EMPTY;
  }
}

export function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab collapsing a group should move this one too.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== KEY) return;
    cache = null;
    onChange();
  };
  try { window.addEventListener("storage", onStorage); } catch { /* nothing to sync with */ }
  return () => {
    listeners.delete(onChange);
    try { window.removeEventListener("storage", onStorage); } catch { /* already gone */ }
  };
}

export function getSnapshot(): readonly string[] {
  if (cache === null) cache = read();
  return cache;
}

export function getServerSnapshot(): readonly string[] {
  return EMPTY;
}

export function toggleGroup(id: string): void {
  const current = getSnapshot();
  const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  cache = Object.freeze(next);
  try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* the rail still works, it just forgets */ }
  for (const l of listeners) l();
}
