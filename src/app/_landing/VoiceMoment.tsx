'use client';

import { useState } from 'react';

const WAVE_HEIGHTS = [
  18, 28, 42, 30, 50, 68, 44, 38, 54, 72, 60, 46, 34, 56, 78, 62, 48, 40, 58,
  74, 82, 66, 50, 38, 46, 62, 54, 36, 48, 66, 80, 72, 58, 44, 32, 50, 68, 60,
  42, 54, 70, 78, 64, 48, 36, 44, 58, 52, 38, 28, 42, 56, 64, 50, 36,
];
const TOTAL_BARS = WAVE_HEIGHTS.length;
const PLAYED_BARS = Math.round(TOTAL_BARS * 0.52);

export default function VoiceMoment() {
  const [playing, setPlaying] = useState(false);

  return (
    <section className="voice-section">
      <div className="voice-container">
        <div className="voice-header">
          <span className="voice-quote-mark">&ldquo;</span>
          <div className="voice-tag">
            <span className="pulse"></span>
            Hear before you hire
          </div>
          <h2 className="voice-headline">
            Before you message them,
            <br />
            <em>hear them.</em>
          </h2>
          <p className="voice-sub">
            Every professional records two voice samples during vetting — a self-introduction and a reading
            passage. Play them before you ever click Message. No other platform shows you this much before the
            first interaction.
          </p>
        </div>

        <div className="voice-featured">
          <div className="voice-featured-glow"></div>
          <div className="voice-card featured">
            <div className="voice-avatar">
              <span>YN</span>
              <div className="voice-live-ring"></div>
            </div>

            <div className="voice-identity">
              <div className="voice-live-badge">
                <span className="dot"></span>
                Live audio sample
              </div>
              <div className="voice-name">Yasmin N.</div>
              <div className="voice-meta">
                Executive Assistant
                <span className="sep">·</span>
                5 years experience
                <span className="sep">·</span>
                Egypt
              </div>
              <div className="voice-waveform">
                {WAVE_HEIGHTS.map((h, i) => (
                  <div
                    key={i}
                    className={`voice-wave-bar${i < PLAYED_BARS ? ' played' : ''}`}
                    style={{ height: `${(h / 100) * 48}px` }}
                  />
                ))}
              </div>
            </div>

            <div className="voice-play">
              <button
                className="voice-play-btn"
                aria-label={playing ? 'Pause voice sample' : 'Play voice sample'}
                onClick={() => setPlaying((p) => !p)}
              >
                {playing ? (
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="5" width="4" height="14" rx="1" />
                    <rect x="14" y="5" width="4" height="14" rx="1" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="7,4 20,12 7,20" />
                  </svg>
                )}
              </button>
              <span className="voice-duration">0:47 / 1:30</span>
            </div>
          </div>
        </div>

        <div className="voice-small-grid">
          <div className="voice-card small">
            <div className="voice-avatar a2">
              <span>AM</span>
            </div>
            <div className="voice-small-body">
              <div className="voice-small-name">Ahmad M.</div>
              <div className="voice-small-role">Paralegal · Jordan</div>
            </div>
            <div className="voice-small-play">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="7,4 20,12 7,20" />
              </svg>
            </div>
          </div>

          <div className="voice-card small">
            <div className="voice-avatar a3">
              <span>PR</span>
            </div>
            <div className="voice-small-body">
              <div className="voice-small-name">Priya R.</div>
              <div className="voice-small-role">Bookkeeper · India</div>
            </div>
            <div className="voice-small-play">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="7,4 20,12 7,20" />
              </svg>
            </div>
          </div>

          <div className="voice-card small">
            <div className="voice-avatar a4">
              <span>FO</span>
            </div>
            <div className="voice-small-body">
              <div className="voice-small-name">Fadilah O.</div>
              <div className="voice-small-role">Social Media Manager · Nigeria</div>
            </div>
            <div className="voice-small-play">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="7,4 20,12 7,20" />
              </svg>
            </div>
          </div>
        </div>

        <p className="voice-footnote">
          <strong>Every voice sample is recorded live during vetting.</strong> No uploads. No edits. No
          AI-generated audio.
        </p>
      </div>
    </section>
  );
}
