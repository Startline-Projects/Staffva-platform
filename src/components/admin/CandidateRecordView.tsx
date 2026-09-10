import Link from "next/link";
import type { CandidateRecord } from "@/lib/adminCandidate";
import CandidateActions from "@/components/admin/CandidateActions";

/**
 * The candidate record, as a pure view over an already-loaded record.
 *
 * Split from the route so the page stays routing plus auth and this stays
 * presentation — which also means it can be rendered against a fabricated
 * record without a session, and what gets checked is this component rather
 * than a copy of it in a harness.
 */

/* ── formatting ── */

const fmtDate = (v: unknown): string | null =>
  typeof v === "string" && v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

const fmtDateTime = (v: unknown): string | null =>
  typeof v === "string" && v ? new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : null;

/**
 * `value || null` reads a legitimate 0 or false as missing. Zero cheat flags
 * is an answer — arguably the answer a reviewer most wants — and rendering it
 * as "not on file" claims we never looked. These two keep the distinction:
 * null and undefined are absent, everything else is data.
 */
const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

const bool = (v: unknown, yes: string, no: string): string | null =>
  v === null || v === undefined ? null : v ? yes : no;

function initials(name: string, email: string): string {
  const src = name || email;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const STATUS: Record<string, { label: string; tone: string }> = {
  approved: { label: "Live", tone: "ok" },
  rejected: { label: "Rejected", tone: "mute" },
  pending_review: { label: "In review", tone: "warn" },
  profile_review: { label: "Profile review", tone: "warn" },
  pending_2nd_interview: { label: "2nd interview", tone: "warn" },
  active: { label: "Applying", tone: "mute" },
};

/** A label/value cell. `tone` colours the value; `empty` says so plainly. */
function Field({
  k,
  v,
  tone,
  mono,
  note,
}: {
  k: string;
  v: React.ReactNode;
  tone?: "ok" | "warn" | "bad";
  mono?: boolean;
  note?: string | null;
}) {
  const isEmpty = v === null || v === undefined || v === "";
  return (
    <div className="rec-field">
      <div className="rec-k">{k}</div>
      <div className={`rec-v${isEmpty ? " empty" : ""}${tone && !isEmpty ? ` ${tone}` : ""}${mono && !isEmpty ? " mono" : ""}`}>
        {isEmpty ? "not on file" : v}
      </div>
      {note && <div className="rec-note-line">{note}</div>}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: string; children: React.ReactNode }) {
  return (
    <section className="rec-section">
      <div className="rec-section-head">
        <h2>
          {title}
          {count && <span className="count">{count}</span>}
        </h2>
      </div>
      {children}
    </section>
  );
}

/** JSON-ish columns (skills, tools, languages) render as chips when they are
 *  a list and as prose when they are not — the schema allows both. */
function Chips({ value }: { value: unknown }) {
  const list = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim()
      ? value.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
      : [];
  if (!list.length) return <span className="rec-v empty">not on file</span>;
  return (
    <div className="rec-chips">
      {list.slice(0, 40).map((s, i) => (
        <span key={i} className="rec-chip">{typeof s === "string" ? s : JSON.stringify(s)}</span>
      ))}
    </div>
  );
}

export default function CandidateRecordView({
  record,
  canDecide,
}: {
  record: CandidateRecord;
  canDecide: boolean;
}) {
  const { c, recruiter, events, hasHistory, engagements, aiInterviews, platform } = record;

  const name = c.full_name || c.display_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || "—";
  const status = STATUS[c.admin_status] ?? { label: c.admin_status || "unknown", tone: "mute" };
  const lockedOut = c.test_lockout_until && new Date(c.test_lockout_until) > new Date();

  return (
    <div className="adm-col" style={{ maxWidth: 1080 }}>
      <Link href="/admin/users?tab=candidates" className="rec-back">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        All candidates
      </Link>

      {/* ═══ HERO ═══ */}
      <div className="rec-hero">
        <div className="rec-hero-top">
          <div className="rec-photo">
            {c.profile_photo_url
              /* eslint-disable-next-line @next/next/no-img-element */
              ? <img src={c.profile_photo_url} alt="" />
              : initials(name, c.email || "")}
          </div>

          <div style={{ minWidth: 0 }}>
            <h1 className="rec-title">
              {name}
              <span className={`adm-pill ${status.tone}`}>{status.label}</span>
              {c.ban_pending_review && <span className="adm-pill bad">Ban requested</span>}
            </h1>
            <div className="rec-sub">
              <span>{c.email || "no email"}</span>
              <span className="sep">·</span>
              <span>{[c.role_title, c.role_category].filter(Boolean).join(" · ") || "no role set"}</span>
              <span className="sep">·</span>
              <span>{[c.city, c.country].filter(Boolean).join(", ") || "no location"}</span>
            </div>
          </div>

          <CandidateActions candidateId={c.id} adminStatus={c.admin_status} canDecide={canDecide} />
        </div>

        <div className="rec-facts">
          <div className="rec-fact">
            <div className="rec-k">Rate</div>
            <div className="rec-v">{c.hourly_rate ? `$${Number(c.hourly_rate).toLocaleString()}/hr` : "—"}</div>
          </div>
          <div className="rec-fact">
            <div className="rec-k">Specialist</div>
            <div className="rec-v">
              {recruiter ? (recruiter.fullName || recruiter.email) : c.assignment_pending_review ? "awaiting routing" : "unassigned"}
            </div>
          </div>
          <div className="rec-fact">
            <div className="rec-k">Applied</div>
            <div className="rec-v">{fmtDate(c.created_at) ?? "—"}</div>
          </div>
          <div className="rec-fact">
            <div className="rec-k">Reputation</div>
            <div className="rec-v">
              {c.reputation_score !== null && c.reputation_score !== undefined
                ? `${c.reputation_score}${c.reputation_tier ? ` · ${c.reputation_tier}` : ""}`
                : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ ATTENTION BANNERS ═══ */}
      {c.ban_pending_review && (
        <div className="prof-banner danger">
          <span className="prof-banner-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></svg>
          </span>
          <div className="prof-banner-body">
            <div className="prof-banner-title">A ban has been requested for this candidate</div>
            <div className="prof-banner-text">
              {c.ban_reason || "No reason recorded."}{" "}
              {fmtDate(c.ban_requested_at) && `Requested ${fmtDate(c.ban_requested_at)}. `}
              Rule on it from <Link href="/pending-bans" className="row-link">Pending Bans</Link>.
            </div>
          </div>
        </div>
      )}

      {lockedOut && (
        <div className="prof-banner">
          <span className="prof-banner-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></svg>
          </span>
          <div className="prof-banner-body">
            <div className="prof-banner-title">Locked out of the English test</div>
            <div className="prof-banner-text">
              Until {fmtDateTime(c.test_lockout_until)}.{" "}
              {c.anticheat_lockout_reason ? `Reason on file: ${c.anticheat_lockout_reason}. ` : ""}
              Lift it from <Link href="/admin/lockouts" className="row-link">Lockouts</Link>.
            </div>
          </div>
        </div>
      )}

      {c.admin_revision_note && (
        <div className="prof-banner info">
          <span className="prof-banner-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4l10-10-4-4L4 16z" /></svg>
          </span>
          <div className="prof-banner-body">
            <div className="prof-banner-title">Revisions were requested{fmtDate(c.admin_revision_sent_at) ? ` on ${fmtDate(c.admin_revision_sent_at)}` : ""}</div>
            <div className="prof-banner-text">{c.admin_revision_note}</div>
          </div>
        </div>
      )}

      {/* ═══ APPLICATION ═══ */}
      <Section title="Application">
        <div className="rec-grid">
          <Field k="Status" v={status.label} tone={status.tone === "ok" ? "ok" : status.tone === "warn" ? "warn" : undefined} />
          <Field k="Stage" v={c.application_stage ?? c.application_step} mono />
          <Field k="Screening tag" v={c.screening_tag} tone={c.screening_tag === "Hold" ? "warn" : undefined} />
          <Field k="Screening score" v={c.screening_score} mono />
          <Field k="Waiting since" v={fmtDate(c.waiting_since)} />
          <Field k="Entered review" v={fmtDate(c.review_entered_at)} />
          <Field k="Profile completed" v={fmtDate(c.profile_completed_at)} />
          <Field k="Went live" v={fmtDate(c.profile_went_live_at)} />
          <Field
            k="Assigned"
            v={recruiter ? (recruiter.fullName || recruiter.email) : null}
            note={c.assignment_pending_review ? "flagged for manual routing" : fmtDate(c.assigned_recruiter_at) ? `since ${fmtDate(c.assigned_recruiter_at)}` : null}
          />
          <Field k="Last updated" v={fmtDate(c.updated_at)} />
        </div>
        {c.screening_reason && (
          <div className="rec-panel" style={{ marginTop: 12 }}>
            <div className="rec-panel-label">Screening reason</div>
            <div className="rec-prose">{c.screening_reason}</div>
          </div>
        )}
      </Section>

      {/* ═══ ASSESSMENTS ═══ */}
      <Section title="Assessments">
        {platform.withEnglishScore === 0 ? (
          <div className="rec-empty" style={{ marginBottom: 12 }}>
            <strong>No English score on file — and none of the {platform.total.toLocaleString()} candidates
            on the platform has one.</strong> The scores were cleared platform-wide, so this is not a
            fact about this person. {c.retake_count > 0
              ? `${c.retake_count} retake${c.retake_count === 1 ? "" : "s"} recorded against this account.`
              : "No retake recorded against this account."}
          </div>
        ) : (
          <div className="rec-grid" style={{ marginBottom: 12 }}>
            <Field k="Grammar" v={c.english_mc_score !== null ? `${c.english_mc_score}%` : null} mono />
            <Field k="Comprehension" v={c.english_comprehension_score !== null ? `${c.english_comprehension_score}%` : null} mono />
            <Field k="Written tier" v={c.english_written_tier} />
            <Field k="Percentile" v={c.english_percentile} mono />
            <Field k="Completed" v={fmtDate(c.test_completed_at)} />
            <Field k="Retakes" v={c.retake_count} mono />
          </div>
        )}

        <div className="rec-grid">
          <Field
            k="AI interview"
            v={c.ai_interview_passed === true ? "Passed" : c.ai_interview_passed === false ? "Not passed" : null}
            tone={c.ai_interview_passed === true ? "ok" : c.ai_interview_passed === false ? "warn" : undefined}
            note={c.ai_interview_score === null ? "no score stored" : null}
          />
          <Field k="Badge" v={c.ai_interview_badge} />
          <Field k="Sittings on record" v={aiInterviews.length} mono note={aiInterviews.length ? aiInterviews.map((a) => a.kind ?? "—").join(", ") : null} />
          <Field k="Interview consent" v={bool(c.interview_consent, "Given", "Not given")} tone={c.interview_consent ? "ok" : undefined} note={fmtDate(c.interview_consent_at)} />
        </div>

        <div style={{ marginTop: 12 }}>
          {c.voice_recording_1_url || c.voice_recording_2_url || c.video_intro_url ? (
            <>
              {c.voice_recording_1_url && (
                <div className="rec-media">
                  <div className="rec-media-body"><div className="rec-media-label">Oral reading</div></div>
                  <audio controls preload="none" src={c.voice_recording_1_url} />
                </div>
              )}
              {c.voice_recording_2_url && (
                <div className="rec-media">
                  <div className="rec-media-body"><div className="rec-media-label">Self introduction</div></div>
                  <audio controls preload="none" src={c.voice_recording_2_url} />
                </div>
              )}
              {c.video_intro_url && (
                <div className="rec-media">
                  <div className="rec-media-body">
                    <div className="rec-media-label">Video intro</div>
                    <div className="rec-note-line">{c.video_intro_status ?? "no status"} · {fmtDate(c.video_intro_submitted_at) ?? "no date"}</div>
                  </div>
                  <Link href={c.video_intro_url} className="adm-btn">Open</Link>
                </div>
              )}
            </>
          ) : (
            <div className="rec-empty">No voice recordings or video intro on file.</div>
          )}
        </div>
      </Section>

      {/* ═══ IDENTITY & INTEGRITY ═══ */}
      <Section title="Identity &amp; integrity">
        <div className="rec-grid">
          <Field
            k="ID verification"
            v={c.id_verification_status}
            tone={c.id_verification_status === "passed" ? "ok" : c.id_verification_status === "failed" ? "bad" : c.id_verification_status ? "warn" : undefined}
          />
          <Field k="Submitted" v={fmtDate(c.id_verification_submitted_at)} />
          <Field k="Reviewed" v={fmtDate(c.id_verification_reviewed_at)} />
          <Field k="Due by" v={fmtDate(c.id_verification_due_at)} />
          <Field k="Integrity pledge" v={bool(c.integrity_pledge_accepted, "Accepted", "Not accepted")} tone={c.integrity_pledge_accepted ? "ok" : undefined} note={fmtDate(c.integrity_pledge_accepted_at)} />
          <Field k="Proctor consent" v={fmtDate(c.proctor_consent_at)} note={c.proctor_consent_version ? `v${c.proctor_consent_version}` : null} />
          <Field k="Cheat flags" v={num(c.cheat_flag_count)} tone={c.cheat_flag_count > 0 ? "warn" : undefined} mono />
          <Field k="Anti-cheat strikes" v={num(c.anticheat_strike_count)} tone={c.anticheat_strike_count > 0 ? "warn" : undefined} mono />
          {/* Not an integrity signal, whatever the column is called: gradeAttempt
              sets it with `overall > 80`, so it marks high scorers. Labelled
              for what it measures and given no alarm colour. */}
          <Field
            k="Scored above 80"
            v={bool(c.score_mismatch_flag, "Yes", "No")}
            note={c.score_mismatch_flag ? "stored in score_mismatch_flag — the name predates the check" : null}
          />
          <Field k="Permanently blocked" v={bool(c.permanently_blocked, "Yes", "No")} tone={c.permanently_blocked ? "bad" : undefined} />
        </div>
        {c.id_verification_review_note && (
          <div className="rec-panel" style={{ marginTop: 12 }}>
            <div className="rec-panel-label">Reviewer note</div>
            <div className="rec-prose">{c.id_verification_review_note}</div>
          </div>
        )}
      </Section>

      {/* ═══ PROFILE ═══ */}
      <Section title="Profile">
        <div className="rec-grid" style={{ marginBottom: 12 }}>
          <Field k="Display name" v={c.display_name} />
          <Field k="Years experience" v={c.years_experience} mono />
          <Field k="College degree" v={bool(c.has_college_degree, "Yes", "No")} />
          <Field k="US client experience" v={c.us_client_experience} />
          <Field k="Time zone" v={c.time_zone} mono />
          <Field k="LinkedIn" v={c.linkedin_url ? <Link href={c.linkedin_url} className="row-link">Open</Link> : null} />
          <Field k="Résumé" v={c.resume_url ? <Link href={c.resume_url} className="row-link">Open</Link> : null} />
          <Field k="Classified as" v={c.classified_role_category} note={c.role_category_custom || c.custom_role_description || null} />
        </div>

        {c.tagline && (
          <div className="rec-panel">
            <div className="rec-panel-label">Tagline</div>
            <div className="rec-prose">{c.tagline}</div>
          </div>
        )}
        <div className="rec-panel">
          <div className="rec-panel-label">Bio</div>
          {c.bio ? <div className="rec-prose">{c.bio}</div> : <div className="rec-v empty">not on file</div>}
        </div>
        <div className="rec-panel">
          <div className="rec-panel-label">Skills</div>
          <Chips value={c.skills} />
        </div>
        <div className="rec-panel">
          <div className="rec-panel-label">Tools</div>
          <Chips value={c.tools} />
        </div>
        <div className="rec-panel">
          <div className="rec-panel-label">Languages</div>
          <Chips value={c.languages} />
        </div>
        {(c.ai_insight_1 || c.ai_insight_2) && (
          <div className="rec-panel">
            <div className="rec-panel-label">AI insights</div>
            <div className="rec-prose">{[c.ai_insight_1, c.ai_insight_2].filter(Boolean).join("\n\n")}</div>
          </div>
        )}
      </Section>

      {/* ═══ WORK & MONEY ═══ */}
      <Section title="Work &amp; money">
        <div className="rec-grid">
          <Field k="Availability" v={c.availability_status} note={fmtDate(c.availability_date)} />
          <Field k="Hours / week" v={c.hours_per_week ?? c.committed_hours} mono />
          <Field k="Working hours" v={c.working_hours} mono />
          <Field k="Payout method" v={c.payout_method} note={c.payout_currency} />
          <Field k="Payout status" v={c.payout_status} />
          <Field k="Stripe onboarding" v={bool(c.stripe_onboarding_complete, "Complete", "Not started")} tone={c.stripe_onboarding_complete ? "ok" : undefined} />
          <Field
            k="Total earnings"
            v={c.total_earnings_usd === null || c.total_earnings_usd === undefined ? null : `$${Number(c.total_earnings_usd).toLocaleString()}`}
            mono
          />
          <Field k="Engagements" v={engagements.length} mono note={engagements.length ? engagements.map((e) => e.status).join(", ") : null} />
          <Field k="Headset" v={bool(c.has_headset, "Yes", "No")} />
          <Field k="Webcam" v={bool(c.has_webcam, "Yes", "No")} />
        </div>
      </Section>

      {/* ═══ NOTES ═══ */}
      {c.recruiter_notes && (
        <Section title="Specialist notes">
          <div className="rec-panel">
            <div className="rec-prose">{c.recruiter_notes}</div>
          </div>
        </Section>
      )}

      {/* ═══ HISTORY ═══ */}
      <Section title="History" count={hasHistory ? `${events.length} ${events.length === 1 ? "event" : "events"}` : undefined}>
        {hasHistory ? (
          <>
            <div className="rec-timeline">
              {events.map((e) => (
                <div key={e.id} className="rec-event">
                  <span className={`rec-event-dot${e.toStatus === "approved" ? " live" : e.toStatus === "rejected" ? " bad" : ""}`} aria-hidden="true" />
                  <div>
                    <div className="rec-event-title">
                      {e.fromStatus ? <>{e.fromStatus} → <strong>{e.toStatus}</strong></> : <strong>{e.toStatus}</strong>}
                    </div>
                    <div className="rec-event-meta">
                      {e.actorName ?? (e.actorRole === "system" ? "system" : e.actorRole ?? "actor not recorded")}
                    </div>
                    {e.reason && <div className="rec-event-reason">{e.reason}</div>}
                  </div>
                  <div className="rec-event-when">{fmtDateTime(e.createdAt)}</div>
                </div>
              ))}
            </div>
            {events.every((e) => !e.actorName) && (
              <p className="rec-note-line" style={{ marginTop: 10 }}>
                No event on this record names a person. The column exists and the current review
                code writes it, but nothing backfilled the rows that predate it — so anything older
                reads as “system”.
              </p>
            )}
          </>
        ) : (
          <div className="rec-empty">
            Nothing has been recorded against this candidate yet. Status changes made from here are
            written to the history.
          </div>
        )}
      </Section>
    </div>
  );
}
