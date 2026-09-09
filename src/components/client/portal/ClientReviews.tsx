"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ReviewExchange from "@/components/reviews/ReviewExchange";
import { blockReasonFor, type ReviewState } from "@/lib/reviewEligibility";

/**
 * The client's Reviews screen — Atlas's three tabs, against what the database
 * can actually defend.
 *
 * CUT FROM THE PROTOTYPE, and why:
 *
 *  - "Atlas Trust Score" (Verification 100% / Payment history 100% /
 *    Communication 98% / Engagement length 85%). No formula, no weights, no
 *    scale — the same concept is drawn as "95/100" elsewhere in the same file.
 *    Invented outright.
 *  - The five reputation stats: avg approval time, on-time payment %, avg
 *    response time, re-hire rate, disputes filed. "On-time" needs a due-date
 *    model we do not have, response time needs message-latency tracking we do
 *    not do, and re-hire needs a rehire event — there is no rehire flag on
 *    `reviews` at all, in either direction.
 *  - Per-category star rows (Communication / Quality of work / Reliability /
 *    …). `reviews` stores ONE integer rating and an optional body. The
 *    prototype's own taxonomy disagrees with itself: cards show 6 categories,
 *    the capture modal collects 4, and the talent-to-client cards show a
 *    different 6.
 *  - "30-day check-in" and "Mid-engagement note" review types, with their
 *    hours/pay-period/approval-time stat row. There is one review per side per
 *    engagement, not a cadence of them.
 *  - "Remind me in a week" / "Skip this check-in". No snooze or skip state
 *    exists, and both are dead in the prototype too.
 *  - The "verified stamp" and "From 2 verified reviews" — "verified" is never
 *    defined anywhere in the prototype.
 *
 * THE CLAIM WE HAD TO NARROW: Atlas says these reviews "appear on your public
 * client profile" and that "candidates see them when deciding whether to
 * message back". Half right here, and the half that is wrong is "public".
 * `client_reviews_private` grants SELECT to postgres and service_role only —
 * so nothing reads it from the browser — but src/lib/clientProfile.ts reads it
 * with the service role behind a relationship gate, and shows it to a
 * candidate this client has made an offer to, messaged or hired.
 *
 * So: not public, not StaffVA-only either. A first version of this banner said
 * "only StaffVA can read them", which was false, and step 17's help article
 * inherited the same sentence. Both now describe the actual audience.
 * Candidate reviews DO go to `candidate_reviews_public`, which anon can read —
 * that asymmetry is real and the banner keeps it.
 */

function Stars({ n }: { n: number }) {
  return (
    <span className="rv-stars" aria-label={`${n} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= n ? "on" : undefined} aria-hidden="true">★</span>
      ))}
    </span>
  );
}

function day(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type Tab = "write" | "left" | "about";

export default function ClientReviews({ states }: { states: ReviewState[] }) {
  const router = useRouter();

  // Every count is derived. Atlas hard-codes 1 / 1 / 2 in the markup and its
  // own submit handler then sets them to 0 and 2 by hand.
  const toWrite = states.filter((s) => blockReasonFor(s) === null);
  const leftByYou = states.filter((s) => s.you_submitted);
  const aboutYou = states.filter((s) => s.their_visible);
  // Their review exists, the seal is past, and staff pulled it. Counted
  // nowhere and shown as a plain note — silently dropping it would leave the
  // client's own tab count disagreeing with what they can see.
  const withheld = states.filter((s) => s.their_withheld);
  // Not reviewable yet: no payment has been released on the engagement.
  const notOpen = states.filter((s) => s.window_opened_at === null);

  // Always "To write", even when it is empty: that tab carries the reason a
  // client has nothing to review (no released payment), and "About you" would
  // open on an empty state that explains only the seal.
  const [tab, setTab] = useState<Tab>("write");

  const rated = aboutYou.filter((s) => typeof s.their_rating === "number");
  const avg = rated.length
    ? Math.round((rated.reduce((a, s) => a + (s.their_rating as number), 0) / rated.length) * 10) / 10
    : null;

  const TABS: [Tab, string, number][] = [
    ["write", "To write", toWrite.length],
    ["left", "Left by you", leftByYou.length],
    ["about", "About you", aboutYou.length],
  ];

  return (
    <section className="rv">
      <div className="rv-head">
        <h1 className="rv-title">Reviews</h1>
        <p className="rv-lead">
          Say how an engagement went, and read what your hire said about working with you. Both
          reviews stay sealed until you have each written one, or 30 days pass.
        </p>
      </div>

      <div className="rv-layout">
        <div className="rv-main">
          <div className="rv-tabs" role="tablist">
            {TABS.map(([key, label, count]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                id={`rv-tab-${key}`}
                aria-controls="rv-panel"
                className={`rv-tab${tab === key ? " active" : ""}`}
                onClick={() => setTab(key)}
              >
                {label}
                <span className="rv-tab-count">{count}</span>
              </button>
            ))}
          </div>

          <div id="rv-panel" role="tabpanel" aria-labelledby={`rv-tab-${tab}`}>
          {tab === "write" && (
            <>
              {toWrite.length === 0 ? (
                <div className="rv-empty">
                  <h3>Nothing to review right now</h3>
                  <p>
                    A review opens on an engagement once its first payment has been released — not
                    when it starts, and not when it ends. That way every review on this platform is
                    attached to work that was actually paid for.
                  </p>
                </div>
              ) : (
                <div className="rv-list">
                  {toWrite.map((s) => (
                    <article key={s.engagement_id} className="rv-card open">
                      <h2 className="rv-card-name">{s.counterparty}</h2>
                      <p className="rv-card-sub">
                        {s.engagement_status === "active"
                          ? "Engagement is still running"
                          : `Engagement ${s.engagement_status}`}
                        {s.window_opened_at ? ` · reviewable since ${day(s.window_opened_at)}` : ""}
                      </p>
                      <ReviewExchange state={s} onChange={() => router.refresh()} />
                    </article>
                  ))}
                </div>
              )}

              {/* The answer to "why is this list empty", on the page where the
                  question gets asked. Rendered as a plain list, never as
                  something that can be acted on. */}
              {notOpen.length > 0 && (
                <div className="rv-pending-note">
                  <h3>Not open yet</h3>
                  <p>
                    {notOpen.length === 1 ? "This engagement has" : `${notOpen.length} engagements have`}{" "}
                    no released payment yet, so there is nothing to review on{" "}
                    {notOpen.length === 1 ? "it" : "them"}.
                  </p>
                  <ul>
                    {notOpen.map((s) => (
                      <li key={s.engagement_id}>
                        <span>{s.counterparty}</span>
                        <span className="rv-muted">{s.engagement_status}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="rv-note">
                    Funding and releasing happen on <Link href="/approvals">Approvals</Link>.
                  </p>
                </div>
              )}
            </>
          )}

          {tab === "left" && (
            <div className="rv-list">
              {leftByYou.length === 0 ? (
                <div className="rv-empty">
                  <h3>You haven&apos;t written one yet</h3>
                  <p>Reviews you write will show here, with whether they have been published.</p>
                </div>
              ) : (
                leftByYou.map((s) => (
                  <article key={s.engagement_id} className="rv-card">
                    <h2 className="rv-card-name">{s.counterparty}</h2>
                    <p className="rv-card-sub">Your review · {day(s.your_submitted_at)}</p>
                    {/* The header stops here on purpose. ReviewExchange renders
                        the rating and the text back in EVERY submitted state,
                        along with the seal state and the withdraw control — a
                        first draft printed a summary above it and every card
                        showed the same stars and the same review twice. One
                        component owns how a review looks. */}
                    <ReviewExchange state={s} onChange={() => router.refresh()} />
                  </article>
                ))
              )}
            </div>
          )}

          {tab === "about" && (
            <div className="rv-list">
              {/* Atlas: "These reviews appear on your public client profile.
                  Candidates see them when deciding whether to message back."
                  The opposite is true here — see the file header. */}
              <p className="rv-privacy">
                Reviews about you are not public. There is no public client page and candidates
                browsing the platform cannot find you — but a candidate you have made an offer to,
                messaged or hired can open your profile, and these reviews are on it. That is the
                point of them: someone deciding whether to work for you can see how it went for
                the last person. It does not work the other way round — a review you write about a
                candidate goes on their public profile once it unseals, with your first name
                attached.
              </p>

              {aboutYou.length === 0 ? (
                <div className="rv-empty">
                  <h3>Nothing yet</h3>
                  <p>
                    A review your hire writes stays sealed until you have written yours, or 30 days
                    pass — so this stays empty until one of those happens.
                  </p>
                </div>
              ) : (
                aboutYou.map((s) => (
                  <article key={s.engagement_id} className="rv-card">
                    <div className="rv-card-top">
                      <div>
                        <h2 className="rv-card-name">{s.counterparty}</h2>
                        <p className="rv-card-sub">About you · {day(s.their_submitted_at)}</p>
                      </div>
                      <span className="rv-card-rating">
                        <Stars n={s.their_rating ?? 0} />
                        <span className="rv-stars-num">{(s.their_rating ?? 0).toFixed(1)}</span>
                      </span>
                    </div>
                    {s.their_body ? (
                      <p className="rv-card-body">{s.their_body}</p>
                    ) : (
                      <p className="rv-card-body rv-muted">They left a rating without a comment.</p>
                    )}
                  </article>
                ))
              )}

              {withheld.length > 0 && (
                <p className="rv-note">
                  {withheld.length === 1 ? "One review" : `${withheld.length} reviews`} written about
                  you {withheld.length === 1 ? "was" : "were"} removed by StaffVA and{" "}
                  {withheld.length === 1 ? "is" : "are"} not shown.
                </p>
              )}
            </div>
          )}
          </div>
        </div>

        <aside className="rv-side">
          <div className="rv-rep">
            <span className="rv-rep-eyebrow">How you&apos;ve been rated</span>
            {avg === null ? (
              <>
                <span className="rv-rep-num">—</span>
                <p className="rv-rep-note">
                  No published reviews about you yet. This fills in once a review your hire wrote
                  is unsealed.
                </p>
              </>
            ) : (
              <>
                <span className="rv-rep-num">
                  {avg.toFixed(1)}<span className="rv-rep-of">/5</span>
                </span>
                <Stars n={Math.round(avg)} />
                <p className="rv-rep-note">
                  {/* The denominator is stated because it is small. An average
                      of one review printed bare reads like a track record. */}
                  From {rated.length === 1 ? "1 review" : `${rated.length} reviews`}, private to you
                  and StaffVA.
                </p>
              </>
            )}
          </div>

          <div className="rv-how">
            <h3>How the seal works</h3>
            <ol>
              <li>Either side writes first. It is stored, and hidden.</li>
              <li>
                It unseals when the other side submits theirs — or 30 days after the first one was
                written, whichever comes first.
              </li>
              <li>
                Until it unseals you can withdraw yours. After, neither side can.
              </li>
              <li>
                Once the deadline publishes a lone review, the other side can no longer write one.
                A review written after reading theirs would be a reply, not an account.
              </li>
            </ol>
          </div>
        </aside>
      </div>
    </section>
  );
}
