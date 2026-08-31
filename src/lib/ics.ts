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

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
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
    `ATTENDEE;ROLE=REQ-PARTICIPANT;CN=${esc(e.attendeeEmail)}:mailto:${e.attendeeEmail}`,
    method === "CANCEL" ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

export function icsAttachment(e: IcsEvent, method: "REQUEST" | "CANCEL") {
  return {
    filename: method === "CANCEL" ? "cancelled.ics" : "interview.ics",
    content: Buffer.from(build(e, method)).toString("base64"),
  };
}
