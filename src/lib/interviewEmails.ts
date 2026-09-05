import { sendEmail } from "@/lib/email";
import { icsAttachment } from "@/lib/ics";

/**
 * Every email the interview scheduler sends, in one voice, to both parties.
 * Composed here rather than inline in routes so the booking route, the cancel
 * route and the reminder cron cannot drift apart in copy or in what they
 * attach.
 *
 * Email failures never fail the booking — the row is already committed, the
 * detail page shows the truth, and callers log rather than roll back.
 */

import { notifyCandidate } from "@/lib/notifyCandidate";
import { interviewAdminClient } from "@/lib/interviewBookingData";

const SITE = "https://staffva.com";
const FROM = "StaffVA <notifications@staffva.com>";

export interface BookingEmailData {
  bookingId: string;
  candidateId: string;
  startsAt: Date;
  durationMinutes: number;
  candidate: { name: string; email: string; tz: string };
  client: { name: string; company: string | null; email: string; tz: string | null };
}

function inZone(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(d);
  } catch {
    return d.toUTCString();
  }
}

function shell(heading: string, name: string, lines: string[], cta?: { href: string; label: string }): string {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
    <h2 style="color:#1C1B1A;">${heading}</h2>
    <p style="color:#444;font-size:14px;">Hi ${name},</p>
    ${lines.map((l) => `<p style="color:#444;font-size:14px;line-height:1.6;">${l}</p>`).join("")}
    ${cta ? `<a href="${cta.href}" style="display:inline-block;background:#FE6E3E;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:12px;">${cta.label}</a>` : ""}
    <p style="color:#999;margin-top:24px;font-size:12px;">— The StaffVA Team</p>
  </div>`;
}

const first = (n: string) => n.split(" ")[0] || "there";

export async function sendBookingEmails(b: BookingEmailData): Promise<void> {
  // In-app first: the candidate email below is suppressed by the freeze, so
  // the bell is how this actually reaches them.
  await notifyCandidate(interviewAdminClient(), {
    candidateId: b.candidateId,
    category: "interview",
    title: "A client booked an interview with you",
    body: `${b.client.company || b.client.name} · ${inZone(b.startsAt, b.candidate.tz)}. The join link appears 15 minutes before the start.`,
    route: "/candidate/dashboard",
    dedupeKey: `interview-booked-${b.bookingId}`,
  });

  const manage = `${SITE}/interviews/${b.bookingId}`;
  const clientWho = b.client.company || b.client.name;
  const candTime = inZone(b.startsAt, b.candidate.tz);
  const clientTime = b.client.tz
    ? inZone(b.startsAt, b.client.tz)
    : `${inZone(b.startsAt, "UTC")} (your calendar invite shows this in your local time)`;

  const toClient = sendEmail(
    {
      from: FROM,
      to: b.client.email,
      subject: `Interview booked — ${b.candidate.name}, ${candShortDate(b.startsAt, b.client.tz)}`,
      html: shell(
        "Your interview is booked",
        first(b.client.name),
        [
          `You're meeting <strong>${b.candidate.name}</strong> for a 30-minute video interview on <strong>${clientTime}</strong>.`,
          `The call happens on StaffVA — the link appears on your interview page 15 minutes before the start. A calendar invite is attached.`,
          `Need to move it? You can cancel from the interview page and pick a new time on ${first(b.candidate.name)}'s calendar.`,
        ],
        { href: manage, label: "View your interview" }
      ),
      attachments: [
        icsAttachment(
          {
            bookingId: b.bookingId,
            startsAt: b.startsAt,
            durationMinutes: b.durationMinutes,
            summary: `Interview: ${b.candidate.name} (StaffVA)`,
            description: `30-minute video interview on StaffVA.\nJoin from: ${manage}`,
            attendeeEmail: b.client.email,
          },
          "REQUEST"
        ),
      ],
    },
    { idempotencyKey: `iv-booked-client-${b.bookingId}`, recipientKind: "client", emailType: "interview_booked" }
  );

  const toCandidate = sendEmail(
    {
      from: FROM,
      to: b.candidate.email,
      subject: `New interview — ${clientWho}, ${candShortDate(b.startsAt, b.candidate.tz)}`,
      html: shell(
        "A client booked an interview with you",
        first(b.candidate.name),
        [
          `<strong>${clientWho}</strong> booked a 30-minute video interview with you on <strong>${candTime}</strong>.`,
          `The call happens on StaffVA — the link appears on your interview page 15 minutes before the start. A calendar invite is attached.`,
          `If you genuinely can't make it, cancel from the interview page as early as you can — reliability is part of your profile's reputation.`,
        ],
        { href: manage, label: "View the interview" }
      ),
      attachments: [
        icsAttachment(
          {
            bookingId: b.bookingId,
            startsAt: b.startsAt,
            durationMinutes: b.durationMinutes,
            summary: `Interview: ${clientWho} (StaffVA)`,
            description: `30-minute video interview on StaffVA.\nJoin from: ${manage}`,
            attendeeEmail: b.candidate.email,
          },
          "REQUEST"
        ),
      ],
    },
    { idempotencyKey: `iv-booked-cand-${b.bookingId}`, recipientKind: "candidate", emailType: "interview_booked" }
  );

  await Promise.allSettled([toClient, toCandidate]).then((results) => {
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error(`[interview-emails] booked notice ${i === 0 ? "client" : "candidate"} failed:`, r.reason?.message || r.reason);
      }
    });
  });
}

export async function sendCancellationEmails(
  b: BookingEmailData,
  cancelledBy: "client" | "candidate"
): Promise<void> {
  // The step-17 matrix called this the gap where "the row simply disappears":
  // a cancellation now states itself instead of relying on the candidate
  // noticing an absence. Only when the CLIENT cancels — telling someone about
  // their own cancellation is noise.
  if (cancelledBy === "client") await notifyCandidate(interviewAdminClient(), {
    candidateId: b.candidateId,
    category: "interview",
    title: "Your interview was cancelled",
    body: `The ${inZone(b.startsAt, b.candidate.tz)} interview with ${b.client.company || b.client.name} is off. No action needed from you.`,
    route: "/candidate/dashboard",
    dedupeKey: `interview-cancelled-${b.bookingId}`,
  });

  const clientWho = b.client.company || b.client.name;
  const candTime = inZone(b.startsAt, b.candidate.tz);
  const clientTime = b.client.tz ? inZone(b.startsAt, b.client.tz) : inZone(b.startsAt, "UTC");
  const cancelIcs = (email: string, summary: string) =>
    icsAttachment(
      {
        bookingId: b.bookingId,
        startsAt: b.startsAt,
        durationMinutes: b.durationMinutes,
        summary,
        description: "This interview was cancelled.",
        attendeeEmail: email,
        sequence: 1,
      },
      "CANCEL"
    );

  const jobs: Promise<unknown>[] = [];

  jobs.push(
    sendEmail(
      {
        from: FROM,
        to: b.client.email,
        subject: `Interview cancelled — ${b.candidate.name}`,
        html: shell(
          "Interview cancelled",
          first(b.client.name),
          cancelledBy === "client"
            ? [`Your interview with <strong>${b.candidate.name}</strong> is cancelled. Their calendar is open if you'd like to pick a new time.`]
            : [
                `<strong>${b.candidate.name}</strong> had to cancel your interview scheduled for <strong>${clientTime}</strong>. Sorry about that.`,
                `Their calendar is open if you'd like to rebook, and there are other strong candidates in the same role if not.`,
              ],
          { href: `${SITE}/browse`, label: "Browse candidates" }
        ),
        attachments: [cancelIcs(b.client.email, `Interview: ${b.candidate.name} (StaffVA)`)],
      },
      { idempotencyKey: `iv-cancel-client-${b.bookingId}`, recipientKind: "client", emailType: "interview_cancelled" }
    )
  );

  jobs.push(
    sendEmail(
      {
        from: FROM,
        to: b.candidate.email,
        subject: `Interview cancelled — ${clientWho}`,
        html: shell(
          "Interview cancelled",
          first(b.candidate.name),
          cancelledBy === "candidate"
            ? [`Your interview with <strong>${clientWho}</strong> (${candTime}) is cancelled, and they've been told. The slot is open on your calendar again.`]
            : [`<strong>${clientWho}</strong> cancelled the interview scheduled for <strong>${candTime}</strong>. The slot is open on your calendar again — no action needed.`],
        ),
        attachments: [cancelIcs(b.candidate.email, `Interview: ${clientWho} (StaffVA)`)],
      },
      { idempotencyKey: `iv-cancel-cand-${b.bookingId}`, recipientKind: "candidate", emailType: "interview_cancelled" }
    )
  );

  await Promise.allSettled(jobs).then((results) => {
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error(`[interview-emails] cancel notice ${i === 0 ? "client" : "candidate"} failed:`, r.reason?.message || r.reason);
      }
    });
  });
}

export async function sendReminderEmails(b: BookingEmailData, which: "24h" | "1h"): Promise<void> {
  const manage = `${SITE}/interviews/${b.bookingId}`;
  const clientWho = b.client.company || b.client.name;
  const lead = which === "24h" ? "tomorrow" : "in about an hour";

  const jobs = [
    sendEmail(
      {
        from: FROM,
        to: b.client.email,
        subject: `Reminder: interview with ${b.candidate.name} ${lead}`,
        html: shell(
          "Interview reminder",
          first(b.client.name),
          [
            `Your interview with <strong>${b.candidate.name}</strong> is ${lead}: <strong>${inZone(b.startsAt, b.client.tz || "UTC")}</strong>.`,
            which === "1h"
              ? "The call link is on your interview page — it goes live 15 minutes before the start."
              : "The call happens on StaffVA; the link appears on your interview page shortly before the start.",
          ],
          { href: manage, label: "Open the interview page" }
        ),
      },
      { idempotencyKey: `iv-rem-${which}-client-${b.bookingId}`, recipientKind: "client", emailType: "interview_reminder" }
    ),
    sendEmail(
      {
        from: FROM,
        to: b.candidate.email,
        subject: `Reminder: interview with ${clientWho} ${lead}`,
        html: shell(
          "Interview reminder",
          first(b.candidate.name),
          [
            `Your interview with <strong>${clientWho}</strong> is ${lead}: <strong>${inZone(b.startsAt, b.candidate.tz)}</strong>.`,
            which === "1h"
              ? "The call link is on your interview page — it goes live 15 minutes before the start. Find a quiet spot and check your mic."
              : "The call happens on StaffVA; the link appears on your interview page shortly before the start.",
          ],
          { href: manage, label: "Open the interview page" }
        ),
      },
      { idempotencyKey: `iv-rem-${which}-cand-${b.bookingId}`, recipientKind: "candidate", emailType: "interview_reminder" }
    ),
  ];

  await Promise.allSettled(jobs).then((results) => {
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error(`[interview-emails] ${which} reminder ${i === 0 ? "client" : "candidate"} failed:`, r.reason?.message || r.reason);
      }
    });
  });
}

function candShortDate(d: Date, tz: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz || "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(d);
  } catch {
    return d.toDateString();
  }
}
