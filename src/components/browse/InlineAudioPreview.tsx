"use client";

import { useState, useRef, useEffect } from "react";

interface Props {
  previewUrl: string | null;
  isLoggedIn: boolean;
  candidateName: string;
}

export default function InlineAudioPreview({
  previewUrl,
  isLoggedIn,
  candidateName,
}: Props) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(15);
  const [loading, setLoading] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animRef = useRef<number | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Not logged in — show lock
  if (!isLoggedIn) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2"
        onClick={(e) => e.preventDefault()}
      >
        <svg
          className="h-4 w-4 text-gray-400 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
          />
        </svg>
        <span className="text-[11px] text-gray-400">
          Sign in to hear this candidate
        </span>
      </div>
    );
  }

  // No preview available
  if (!previewUrl) {
    return null;
  }

  async function getSignedUrl() {
    if (signedUrl) return signedUrl;

    try {
      const res = await fetch("/api/storage/signed-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket: "voice-recordings", path: previewUrl }),
      });
      if (res.ok) {
        const data = await res.json();
        const url = data.signedUrl || data.url;
        setSignedUrl(url);
        return url;
      }
    } catch {
      // silent
    }
    return null;
  }

  function updateProgress() {
    if (!audioRef.current) return;
    const current = audioRef.current.currentTime;
    const dur = audioRef.current.duration || duration;
    setProgress((current / dur) * 100);

    if (!audioRef.current.paused) {
      animRef.current = requestAnimationFrame(updateProgress);
    }
  }

  async function togglePlay(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (playing && audioRef.current) {
      audioRef.current.pause();
      setPlaying(false);
      if (animRef.current) cancelAnimationFrame(animRef.current);
      return;
    }

    if (!audioRef.current) {
      setLoading(true);
      const url = await getSignedUrl();
      if (!url) {
        setLoading(false);
        return;
      }

      const audio = new Audio(url);
      audio.preload = "auto";

      audio.onloadedmetadata = () => {
        if (audio.duration && !isNaN(audio.duration) && audio.duration !== Infinity) {
          setDuration(audio.duration);
        }
        setLoading(false);
      };

      audio.onended = () => {
        setPlaying(false);
        setProgress(0);
        if (animRef.current) cancelAnimationFrame(animRef.current);
      };

      audio.onerror = () => {
        setLoading(false);
        setPlaying(false);
      };

      audioRef.current = audio;

      // Wait a moment for loading
      audio.addEventListener("canplay", () => {
        audio.play();
        setPlaying(true);
        setLoading(false);
        animRef.current = requestAnimationFrame(updateProgress);
      }, { once: true });

      audio.load();
    } else {
      audioRef.current.play();
      setPlaying(true);
      animRef.current = requestAnimationFrame(updateProgress);
    }
  }

  function handleBarClick(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();

    if (!audioRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = x / rect.width;
    audioRef.current.currentTime = pct * (audioRef.current.duration || duration);
    setProgress(pct * 100);
  }

  const formatSec = (s: number) => `0:${Math.floor(s).toString().padStart(2, "0")}`;

  return (
    <div
      className="flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2"
      onClick={(e) => e.preventDefault()}
    >
      {/* Play/pause button */}
      <button
        onClick={togglePlay}
        disabled={loading}
        className="flex h-11 w-11 sm:h-7 sm:w-7 shrink-0 items-center justify-center rounded-full bg-[#FE6E3E] text-white hover:bg-[#E55A2B] transition-colors disabled:opacity-50"
        aria-label={playing ? `Pause ${candidateName} preview` : `Play ${candidateName} preview`}
      >
        {loading ? (
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
        ) : playing ? (
          <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg className="h-3 w-3 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Progress bar */}
      <div
        className="flex-1 h-2 sm:h-1.5 rounded-full bg-gray-200 cursor-pointer relative"
        onClick={handleBarClick}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[#FE6E3E] transition-all duration-100"
          style={{ width: `${progress}%` }}
        />
        {/* Animated dots for waveform effect */}
        <div className="absolute inset-0 flex items-center justify-between px-0.5">
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className={`w-0.5 rounded-full transition-all duration-150 ${
                (i / 20) * 100 < progress
                  ? "bg-white h-1.5"
                  : "bg-gray-300 h-1"
              }`}
              style={{
                height: playing && (i / 20) * 100 < progress
                  ? `${3 + Math.sin(Date.now() / 200 + i) * 2}px`
                  : undefined,
              }}
            />
          ))}
        </div>
      </div>

      {/* Duration */}
      <span className="text-[10px] text-gray-400 shrink-0 tabular-nums w-6 text-right">
        {formatSec(duration)}
      </span>
    </div>
  );
}
