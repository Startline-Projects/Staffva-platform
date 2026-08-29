'use client';

import { useEffect, useRef, useState } from 'react';

interface VoiceCandidate {
  id: string;
  display_name: string | null;
  full_name: string | null;
  role_category: string | null;
  country: string | null;
  profile_photo_url: string | null;
  voice_recording_1_url: string | null;
}

interface Props {
  candidates: VoiceCandidate[];
}

const WAVE_HEIGHTS = [
  18, 28, 42, 30, 50, 68, 44, 38, 54, 72, 60, 46, 34, 56, 78, 62, 48, 40, 58,
  74, 82, 66, 50, 38, 46, 62, 54, 36, 48, 66, 80, 72, 58, 44, 32, 50, 68, 60,
  42, 54, 70, 78, 64, 48, 36, 44, 58, 52, 38, 28, 42, 56, 64, 50, 36,
];
const TOTAL_BARS = WAVE_HEIGHTS.length;
const PLAYED_BARS = Math.round(TOTAL_BARS * 0.52);

function getDisplayName(c: VoiceCandidate): string {
  if (c.display_name) return c.display_name;
  if (c.full_name) {
    const parts = c.full_name.trim().split(/\s+/);
    if (parts.length >= 2) return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
    return parts[0];
  }
  return 'Anonymous';
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

const AVATAR_COLORS = ['#F4D9B0', '#C8E6C9', '#BBDEFB', '#FFE0B2'];

// Declared at module scope, not inside VoiceMoment. A component defined during
// render is a NEW component type on every render, so React unmounts and remounts
// it rather than updating it — which restarted Spinner's CSS animation, and
// re-injected its <style> block, every time playback state changed.
function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <polygon points="7,4 20,12 7,20" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} style={{ animation: 'spin 0.8s linear infinite' }}>
      <circle cx="12" cy="12" r="9" strokeOpacity={0.25} />
      <path d="M12 3a9 9 0 0 1 9 9" strokeLinecap="round" />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </svg>
  );
}

export default function VoiceMoment({ candidates }: Props) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const signedUrlCache = useRef<Record<string, string>>({});
  const audioInstances = useRef<Record<string, HTMLAudioElement>>({});

  useEffect(() => {
    return () => {
      Object.values(audioInstances.current).forEach((a) => a.pause());
    };
  }, []);

  const featured = candidates[0] ?? null;
  const small = candidates.slice(1, 4);

  async function togglePlay(id: string, path: string) {
    if (playingId === id) {
      audioInstances.current[id]?.pause();
      setPlayingId(null);
      return;
    }

    Object.entries(audioInstances.current).forEach(([otherId, el]) => {
      if (otherId !== id) el.pause();
    });
    setPlayingId(null);

    let url = signedUrlCache.current[id];
    if (!url) {
      setLoadingId(id);
      try {
        const res = await fetch('/api/storage/signed-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bucket: 'voice-recordings', path }),
        });
        if (!res.ok) { setLoadingId(null); return; }
        const data = await res.json();
        url = data.signedUrl;
        signedUrlCache.current[id] = url;
      } catch {
        setLoadingId(null);
        return;
      }
      setLoadingId(null);
    }

    if (!audioInstances.current[id]) {
      const audio = new Audio(url);
      audio.onended = () => setPlayingId(null);
      audioInstances.current[id] = audio;
    }

    audioInstances.current[id].play();
    setPlayingId(id);
  }

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

        {featured && (
          <div className="voice-featured">
            <div className="voice-featured-glow"></div>
            <div className="voice-card featured">
              <div className="voice-avatar">
                {featured.profile_photo_url ? (
                  <img
                    src={featured.profile_photo_url}
                    alt={getDisplayName(featured)}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                  />
                ) : (
                  <span>{getInitials(getDisplayName(featured))}</span>
                )}
                <div className="voice-live-ring"></div>
              </div>

              <div className="voice-identity">
                <div className="voice-live-badge">
                  <span className="dot"></span>
                  Live audio sample
                </div>
                <div className="voice-name">{getDisplayName(featured)}</div>
                <div className="voice-meta">
                  {featured.role_category}
                  {featured.country && (
                    <>
                      <span className="sep">·</span>
                      {featured.country}
                    </>
                  )}
                </div>
                <div className="voice-waveform">
                  {WAVE_HEIGHTS.map((h, i) => (
                    <div
                      key={i}
                      className={`voice-wave-bar${i < PLAYED_BARS && playingId === featured.id ? ' played' : ''}`}
                      style={{ height: `${(h / 100) * 48}px` }}
                    />
                  ))}
                </div>
              </div>

              <div className="voice-play">
                <button
                  className="voice-play-btn"
                  aria-label={playingId === featured.id ? 'Pause voice sample' : 'Play voice sample'}
                  disabled={loadingId === featured.id}
                  onClick={() => togglePlay(featured.id, featured.voice_recording_1_url!)}
                >
                  {loadingId === featured.id ? <Spinner /> : playingId === featured.id ? <PauseIcon /> : <PlayIcon />}
                </button>
              </div>
            </div>
          </div>
        )}

        {small.length > 0 && (
          <div className="voice-small-grid">
            {small.map((c, idx) => {
              const name = getDisplayName(c);
              return (
                <div className="voice-card small" key={c.id}>
                  <div className="voice-avatar" style={{ background: AVATAR_COLORS[(idx + 1) % AVATAR_COLORS.length] }}>
                    {c.profile_photo_url ? (
                      <img
                        src={c.profile_photo_url}
                        alt={name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                      />
                    ) : (
                      <span>{getInitials(name)}</span>
                    )}
                  </div>
                  <div className="voice-small-body">
                    <div className="voice-small-name">{name}</div>
                    <div className="voice-small-role">
                      {c.role_category}
                      {c.country && ` · ${c.country}`}
                    </div>
                  </div>
                  <button
                    className="voice-small-play"
                    aria-label={playingId === c.id ? 'Pause' : 'Play'}
                    disabled={loadingId === c.id}
                    onClick={() => togglePlay(c.id, c.voice_recording_1_url!)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    {loadingId === c.id ? <Spinner /> : playingId === c.id ? <PauseIcon /> : <PlayIcon />}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <p className="voice-footnote">
          <strong>Every voice sample is recorded live during vetting.</strong> No uploads, no edits.
        </p>
      </div>
    </section>
  );
}
