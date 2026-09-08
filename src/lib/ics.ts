/**
 * Minimal iCalendar generation for interview bookings — enough for Gmail,
 * Outlook and Apple Calendar to add, update and REMOVE the event.
 *
 * The details that make calendars behave:
 *  - A stable UID per booking, so a later METHOD:CANCEL with the same UID
 *    removes the original event instead of orphaning it.
 *  - METHOD:REQUEST needs an ORGANIZER or several clients ignore the invite.
 *  - CRLF line endings; the spec is strict and some parsers are stricter.
 */

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * RFC 5545 TEXT escaping.
 *
 * The CR case is not hypothetical: display_name is directly writable by the
 * candidate (00120 grants update on that column to authenticated), so a name
 * containing a bare \r used to pass straight through — LF was converted to a
 * literal \n but CR was not, and a parser that treats a lone CR as a line
 * break would read whatever followed as new iCalendar properties. Both are
 * normalised to the escaped form before anything else can split on them.
 */
function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n?|\n/g, "\\n");
}

/**
 * Fold to 75 octets per RFC 5545. An unfolded long line is technically
 * invalid and some parsers truncate it; a 400-character display_name is
 * enough to produce one.
 */
function fold(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, "utf8") > 73) {
      out.push(cur);
      cur = " ";
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.join("\r\n");
}

interface IcsEvent {
  bookingId: string;
  startsAt: Date;
  durationMinutes: number;
  summary: string;
  description: string;
  attendeeEmail: string;
  /** Bump on reschedule/cancel so clients apply the update. */
  sequence?: number;
}

function build(e: IcsEvent, method: "REQUEST" | "CANCEL"): string {
  const end = new Date(e.startsAt.getTime() + e.durationMinutes * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//StaffVA//Interviews//EN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:interview-${e.bookingId}@staffva.com`,
    `SEQUENCE:${e.sequence ?? 0}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(e.startsAt)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${esc(e.summary)}`,
    `DESCRIPTION:${esc(e.description)}`,
    "ORGANIZER;CN=StaffVA Interviews:mailto:notifications@staffva.com",
    // The address is escaped on BOTH sides — the mailto half was raw, and an
    // address is not a value we mint ourselves.
    `ATTENDEE;ROLE=REQ-PARTICIPANT;CN=${esc(e.attendeeEmail)}:mailto:${esc(e.attendeeEmail)}`,
    method === "CANCEL" ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n");
}

/**
 * The same calendar body as a plain string, for serving over HTTP rather than
 * attaching to mail. Exported so the download route does not base64-decode
 * icsAttachment's output back into the text it was built from.
 */
export function icsText(e: IcsEvent, method: "REQUEST" | "CANCEL"): string {
  return build(e, method);
}

export type { IcsEvent };

export function icsAttachment(e: IcsEvent, method: "REQUEST" | "CANCEL") {
  return {
    filename: method === "CANCEL" ? "cancelled.ics" : "interview.ics",
    content: Buffer.from(build(e, method)).toString("base64"),
  };
}
