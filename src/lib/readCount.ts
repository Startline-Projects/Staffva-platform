/**
 * Counting, without letting a failed read pass for zero.
 *
 * `res.count ?? 0` was written 76 times across the admin panel. It reads as a
 * harmless default and is not one: PostgREST answers a failed head-count with
 * `count: null`, and `?? 0` turns that into a number indistinguishable from a
 * true zero. One of those sites told /admin/performance that a table holding
 * 11 rows held none, for a week, because the select named a column that does
 * not exist — a 400 with an EMPTY error message, so nothing logged either.
 *
 * Two tools, because there are two situations:
 *
 *  · A number that is DISPLAYED becomes `number | null` (`countOrNull`) and the
 *    view renders `showCount()` — "—", never "0". The type is the point: once a
 *    figure can be null, TypeScript refuses arithmetic and `.toLocaleString()`
 *    on it, so every place that assumed a number has to decide what it shows.
 *
 *  · A number that feeds LOGIC — an alert threshold, a badge — has to stay a
 *    number, and there a false zero is worse than a wrong figure: it removes a
 *    row from a list of problems, and an empty list reads as all-clear.
 *    `FailedReads.count()` returns the zero AND records the label in one act,
 *    so the zero cannot exist without the failure being reportable. Doing those
 *    as two separate steps is how they drift apart.
 *
 * No imports: safe from server loaders, route handlers and client components.
 */

interface CountResult { count: number | null; error: unknown }
interface RowsResult<T> { data: T[] | null; error: unknown }

/** null = the read failed. Zero = the database says zero. */
export function countOrNull(res: CountResult): number | null {
  return res.error || res.count === null ? null : res.count;
}

/** Same rule for a figure derived from rows: no rows read is not "none". */
export function rowsOrNull<T>(res: RowsResult<T>): T[] | null {
  return res.error || res.data === null ? null : res.data;
}

/** Arithmetic over figures that may not have been read: any null poisons the result. */
export function sumOrNull(...parts: (number | null)[]): number | null {
  let total = 0;
  for (const p of parts) {
    if (p === null) return null;
    total += p;
  }
  return total;
}

/** Week-over-week style change. null in → null out, rather than a confident "+100%". */
export function changePercentOrNull(now: number | null, before: number | null): number | null {
  if (now === null || before === null) return null;
  if (before > 0) return Math.round(((now - before) / before) * 100);
  return now > 0 ? 100 : 0;
}

/**
 * For numbers that must stay numbers. Every zero handed out for a failed read
 * leaves its label behind.
 */
export class FailedReads {
  readonly labels: string[] = [];

  /** The count — or 0 with `label` recorded, if it could not be read. */
  count(label: string, res: CountResult): number {
    const n = countOrNull(res);
    if (n === null) { this.note(label); return 0; }
    return n;
  }

  /** The rows — or [] with `label` recorded. */
  rows<T>(label: string, res: RowsResult<T>): T[] {
    const r = rowsOrNull(res);
    if (r === null) { this.note(label); return []; }
    return r;
  }

  note(label: string): void {
    if (!this.labels.includes(label)) this.labels.push(label);
  }

  get any(): boolean { return this.labels.length > 0; }
}

// ── display ─────────────────────────────────────────────────────────────────

/** What a figure that could not be read looks like. Never a digit. */
export const UNREAD = "—";
export const UNREAD_TITLE = "This figure could not be read — it is not zero.";

export function showCount(n: number | null | undefined): string {
  return n === null || n === undefined ? UNREAD : n.toLocaleString();
}

/** "$1,240" / "—" */
export function showUsd(n: number | null | undefined): string {
  return n === null || n === undefined ? UNREAD : `$${Math.round(n).toLocaleString()}`;
}
