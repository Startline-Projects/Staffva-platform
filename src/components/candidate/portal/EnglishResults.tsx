/**
 * A candidate's English assessment result, shown to the person who sat it.
 *
 * Before this existed the six per-part scores rendered ONLY inside the
 * retake-lockout card — so they reached a candidate who had FAILED, and only
 * while their cooldown was still running. Pass, or let the cooldown lapse,
 * and there was nothing, while the results screen told everyone "your score
 * breakdown is on your dashboard". This is that breakdown, for everyone who
 * has one, permanently.
 *
 * It also renders `notes`: the grader writes a one-sentence explanation per
 * part (why listening scored what it did, whether the read-aloud audio was
 * degraded, the model's reasoning on the open parts) into part_scores.notes
 * and no screen has ever displayed them. The scores say where you landed;
 * only the notes say why — which is the whole point of taking an optional
 * assessment to find out where to improve.
 */

/** Keys under notes that are for reviewers, never rendered to the candidate. */
const INTERNAL_NOTE_KEYS = new Set(["read_aloud_internal"]);

const PARTS = [
  ["grammar", "Grammar"],
  ["comprehension", "Comprehension"],
  ["read_aloud", "Read-aloud"],
  ["listening", "Listening"],
  ["speaking", "Speaking"],
  ["writing", "Writing"],
] as const;

const PRACTICE = [
  { title: "BBC Learning English", meta: "Lessons · Free", href: "https://www.bbc.co.uk/learningenglish" },
  { title: "Duolingo", meta: "App · Free", href: "https://www.duolingo.com" },
  { title: "ELSA Speak", meta: "Pronunciation · Freemium", href: "https://elsaspeak.com" },
];

export interface EnglishPartScores {
  [key: string]: unknown;
  overall?: number | null;
  notes?: Record<string, string> | null;
}

export default function EnglishResults({ parts }: { parts: EnglishPartScores | null }) {
  if (!parts) return null;

  const notes = (parts.notes ?? null) as Record<string, string> | null;
  const scored = PARTS.filter(([key]) => typeof parts[key] === "number");
  if (scored.length === 0) return null;

  const overall = typeof parts.overall === "number" ? parts.overall : null;
  // Only name a weakest section when there genuinely IS one: more than one
  // part, a strict low, and something actually worth working on. Otherwise a
  // straight-100 result would still be told where it was "lowest".
  const ranked = [...scored].sort((a, b) => (parts[a[0]] as number) - (parts[b[0]] as number));
  const lowest = ranked[0] ? (parts[ranked[0][0]] as number) : null;
  const weakest =
    ranked.length > 1 &&
    lowest !== null &&
    lowest < (parts[ranked[1][0]] as number) &&
    lowest < 75
      ? ranked[0]
      : null;

  // A part can have a grader note WITHOUT a score — "no recording was
  // submitted for this part", which is precisely the thing a candidate needs
  // told. Scoring drops it from the breakdown, so it would vanish silently.
  const explained = PARTS.filter(
    ([key]) => typeof parts[key] !== "number" && notes?.[key] && !INTERNAL_NOTE_KEYS.has(key)
  );

  return (
    <section className="panel-card" style={{ marginTop: 18 }} aria-labelledby="englishResultsTitle">
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <h3 id="englishResultsTitle" style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
          Your English assessment
        </h3>
        {overall !== null && (
          <span className="current-step-meta-chip">Overall {Math.round(overall)}</span>
        )}
      </div>

      {/* .feedback-block is what atlas-dash.css hangs the score-row layout
          off; without it the public-profile `.lp .score-row` grid applies. */}
      <div className="feedback-block" style={{ marginTop: 12 }}>
      <div className="score-row">
        {scored.map(([key, label]) => {
          const v = parts[key] as number;
          return (
            <span className="score-item" key={key}>
              <span className={`score-n${v >= 75 ? " strong" : v < 60 ? " weak" : ""}`}>{v}</span>
              <span className="score-lbl">{label}</span>
            </span>
          );
        })}
      </div>
      </div>

      {explained.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {explained.map(([key, label]) => (
            <p key={key} style={{ fontSize: 13.5, margin: 0, color: "var(--ink-mute)" }}>
              <strong>{label}:</strong> {notes![key]} (not scored)
            </p>
          ))}
        </div>
      )}

      {notes && scored.some(([key]) => notes[key]) && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-mute)", margin: 0 }}>
            What the grader noted
          </p>
          {scored
            .filter(([key]) => notes[key])
            .map(([key, label]) => (
              <p key={key} style={{ fontSize: 13.5, margin: 0, lineHeight: 1.5 }}>
                <strong>{label}:</strong> {notes[key]}
              </p>
            ))}
        </div>
      )}

      {weakest && (
        <p style={{ marginTop: 14, fontSize: 13.5, color: "var(--ink-mute)" }}>
          {/* Names the lowest scored part rather than a generic "keep
              practising". The links below are general-purpose, so the copy
              must not imply they are tailored to this result. */}
          Your lowest section was <strong>{weakest[1]}</strong>. These are
          general practice resources — not tailored to your answers, but a
          reasonable place to start.
        </p>
      )}

      <div className="resource-links" style={{ marginTop: 10 }}>
        {PRACTICE.map((r) => (
          <a key={r.title} className="resource-link" href={r.href} target="_blank" rel="noopener noreferrer">
            <span className="resource-link-icon" aria-hidden>↗</span>
            <span className="resource-link-title">{r.title}</span>
            <span className="resource-link-meta">{r.meta}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
