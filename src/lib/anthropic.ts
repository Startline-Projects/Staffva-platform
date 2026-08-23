/**
 * Pull the assistant's text out of a raw Messages API response body.
 *
 * Every Anthropic call in this app is a hand-rolled fetch, and each one used to
 * read `data.content[0].text` — the text block is at index 0, so it worked.
 *
 * It works only for as long as the model returns nothing else first. On models
 * from Sonnet 5 onward, extended thinking is ON by default unless the request
 * explicitly disables it, and a thinking block can lead the content array. Index
 * 0 is then a thinking block whose `.text` is undefined, and every call site
 * here has an `|| ""` or a canned fallback behind it — so the failure would not
 * throw, would not log, and would not show up anywhere. Roles would stop being
 * classified, screening would return nothing, and generated contracts would come
 * out empty, all with a 200 response.
 *
 * That is the same shape as the model retirement that broke the interview app
 * for ten weeks: a vendor-side default changed, and the code degraded quietly
 * instead of failing. Selecting the block by TYPE rather than by POSITION is
 * correct on both the current model and any later one, so the trap never arms.
 *
 * Returns "" when there is no text block, matching what the call sites already
 * expected, so their existing fallbacks still apply.
 */
export function extractText(data: unknown): string {
  const content = (data as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return "";

  const block = content.find(
    (b): b is { type: "text"; text: string } =>
      !!b && typeof b === "object" && (b as { type?: unknown }).type === "text"
  );

  return typeof block?.text === "string" ? block.text : "";
}
