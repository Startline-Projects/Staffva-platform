import { UNREAD, UNREAD_TITLE } from "@/lib/readCount";

/**
 * A figure that may not have been read.
 *
 * Renders "—", never a digit, when the value is null — with a title saying
 * why, because a bare dash in a grid of numbers otherwise reads as "none".
 * No hooks, so it works in server and client components alike.
 *
 * It exists because `{value}` compiles happily when `value` is null and then
 * renders NOTHING: making a loader honest about a failed read would otherwise
 * swap a false zero for a blank, which is quieter but no more true.
 */
export default function Fig({ n, usd = false }: { n: number | null | undefined; usd?: boolean }) {
  if (n === null || n === undefined) {
    return <span className="fig-unread" title={UNREAD_TITLE}>{UNREAD}</span>;
  }
  return <>{usd ? `$${Math.round(n).toLocaleString()}` : n.toLocaleString()}</>;
}
