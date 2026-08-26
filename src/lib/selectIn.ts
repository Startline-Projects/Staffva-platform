/**
 * Run a PostgREST `.in(column, ids)` query safely for any number of ids.
 *
 * supabase-js serialises `.in()` into the request URL as
 * `column=in.(uuid,uuid,...)`. A UUID plus its separator is ~37 bytes, so the
 * URL grows linearly with the id count, and the edge rejects the request once it
 * gets too long.
 *
 * Measured against this project's own endpoint (no credentials — a 401 proves
 * the URL was accepted and only auth failed):
 *
 *   1,500 ids   55,559 bytes   401
 *   1,600 ids   59,259 bytes   401
 *   1,700 ids   62,959 bytes   connection dropped
 *   1,750 ids   64,809 bytes   connection dropped
 *
 * So the ceiling is ~1,650 ids, around 60KB of URL. Past it the request does not
 * return a status code at all — the connection is closed, which surfaces as a
 * generic fetch failure rather than anything that names the real cause.
 *
 * Thirteen routes build an `.in()` out of a previous query's ids and not one of
 * them bounds the list. At today's 254 candidates every one is comfortably under
 * the limit, which is why this has never been seen. At the 10,000-candidate
 * target most of them are several times over it.
 *
 * Chunking at 500 keeps each URL near 18KB — roughly a third of the proven-good
 * size — and leaves the caller's own filters untouched, so nothing about the
 * query's meaning changes. Chunks run concurrently; the first error wins.
 */

const DEFAULT_CHUNK_SIZE = 500;

type Result<T> = { data: T[] | null; error: { message: string } | null };

export async function selectIn<T>(
  ids: readonly string[],
  run: (chunk: string[]) => PromiseLike<Result<T>>,
  chunkSize: number = DEFAULT_CHUNK_SIZE
): Promise<{ data: T[]; error: { message: string } | null }> {
  // No ids means no rows. Returning early also removes the need for the
  // `ids.length > 0 ? ids : ["none"]` sentinel these callers were using, which
  // asked the database to look for a candidate literally named "none".
  if (ids.length === 0) return { data: [], error: null };

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    chunks.push(ids.slice(i, i + chunkSize) as string[]);
  }

  const results = await Promise.all(chunks.map((chunk) => run(chunk)));

  const failed = results.find((r) => r.error);
  if (failed?.error) return { data: [], error: failed.error };

  return { data: results.flatMap((r) => r.data ?? []), error: null };
}
