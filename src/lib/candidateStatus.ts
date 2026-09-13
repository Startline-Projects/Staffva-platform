/**
 * What "live" means for a candidate.
 *
 * admin_status used to call this state `approved`, which read as a judgment —
 * "we vetted them and said yes". It never meant that. The gate is six profile
 * fields and two voice recordings; the English test and the skills interview
 * are optional and gate nothing. 225 of 253 live candidates have taken no
 * assessment at all. So the state is `live`, which is what it has always been.
 *
 * BOTH labels are accepted on read, deliberately. The enum carries `approved`
 * and `live` at once so the database and the deployment can change at
 * different moments without a window where one asks the other about a label it
 * does not have. Writes go to `live` only.
 *
 * Once every row is `live` and this has been deployed for a while, isLive can
 * drop the `approved` arm — but there is no urgency, and leaving it costs a
 * string comparison.
 *
 * NOT related: video_intro_status, recruiter_photo_status, milestone status
 * and Twilio's verification check all have their own `approved` values. This
 * helper is for admin_status and nothing else.
 */

/** The value to WRITE. */
export const LIVE_STATUS = "live" as const;

/** For `.in("admin_status", …)` filters. */
export const LIVE_STATUSES = ["approved", "live"] as const;

/** Is this candidate live and visible to clients? */
export function isLive(status: string | null | undefined): boolean {
  return status === "live" || status === "approved";
}
