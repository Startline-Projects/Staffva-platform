"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

const INSTRUCTIONS = [
  { num: 1, title: "Greeting", text: "Greet the viewer using your first name only. Keep it warm and professional." },
  { num: 2, title: "Professional Background", text: "Briefly describe your professional background — years of experience, key industries, and your area of expertise." },
  { num: 3, title: "What You Bring to a Client", text: "Explain the value you bring — what problems you solve, what you excel at, and why a client should choose you." },
  { num: 4, title: "Direct Close", text: "End with a direct closing statement — express your interest in working with the viewer and invite them to reach out." },
];

const TIPS = [
  {
    title: "Setup",
    items: [
      "Use a quiet, well-lit space with a clean background",
      "Position the camera at eye level — not looking up or down",
      "Ensure stable internet if recording in-browser",
      "Use natural light facing you, not behind you",
    ],
  },
  {
    title: "Appearance",
    items: [
      "Wear professional or business casual clothing",
      "Keep your background clean and distraction-free",
      "Avoid hats, sunglasses, or anything that obscures your face",
      "Present yourself as you would for a client meeting",
    ],
  },
  {
    title: "Delivery",
    items: [
      "Speak clearly and at a moderate pace",
      "Look directly at the camera — not at yourself on screen",
      "Smile naturally — you want to appear approachable",
      "Keep it between 30 and 90 seconds — concise and focused",
    ],
  },
  {
    title: "What to Avoid",
    items: [
      "Do not share your last name, phone number, or email",
      "Do not mention specific client names or companies",
      "Do not use background music or filters",
      "Do not read from a script — conversational is best",
    ],
  },
];

export default function VideoIntroPage() {
  const [phase, setPhase] = useState<"instructions" | "upload">("instructions");
  const [guidelinesChecked, setGuidelinesChecked] = useState(false);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [expandedTip, setExpandedTip] = useState<number | null>(null);
  const instructionsRef = useRef<HTMLDivElement>(null);

  // Upload state
  const [activeTab, setActiveTab] = useState<"record" | "upload">("upload");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [duration, setDuration] = useState(0);

  // Recording state
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Scroll tracking for instructions
  const handleScroll = useCallback(() => {
    const el = instructionsRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      setHasScrolledToBottom(true);
    }
  }, []);

  // Check if already submitted
  useEffect(() => {
    async function check() {
      try {
        const res = await fetch("/api/candidate/video-intro");
        const data = await res.json();
        if (data.video_intro_status === "pending_review") {
          setSuccess(true);
          setPhase("upload");
        }
      } catch { /* silent */ }
    }
    check();
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
  }, [previewUrl, recordedUrl]);

  // ═══ FILE UPLOAD ═══

  function handleFileSelect(file: File) {
    setError("");
    setSelectedFile(null);
    setPreviewUrl("");
    setDuration(0);

    // Type validation
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["mp4", "mov"].includes(ext || "")) {
      setError("Only MP4 and MOV files are accepted. Please select a valid video file.");
      return;
    }

    // Size validation (200MB)
    if (file.size > 200 * 1024 * 1024) {
      setError("File size exceeds 200MB. Please compress or trim your video and try again.");
      return;
    }

    // Duration validation
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = url;
    video.onloadedmetadata = () => {
      const dur = video.duration;
      URL.revokeObjectURL(url);

      if (dur < 30) {
        setError("Your video must be at least 30 seconds. Please re-record or upload a longer video.");
        return;
      }
      if (dur > 90) {
        setError("Your video must be under 90 seconds. Please trim or re-record.");
        return;
      }

      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setDuration(Math.round(dur));
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      setError("Could not read this video file. Please try a different file.");
    };
  }

  // ═══ CAMERA RECORDING ═══

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setCameraReady(true);
    } catch {
      setError("Camera access denied. Please allow camera and microphone access in your browser settings.");
    }
  }

  function startRecording() {
    if (!streamRef.current) return;
    setError("");
    chunksRef.current = [];
    setRecordedBlob(null);
    setRecordedUrl("");
    setRecordingTime(0);
    setShowWarning(false);

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : "video/webm";

    const mr = new MediaRecorder(streamRef.current, { mimeType });
    mediaRecorderRef.current = mr;

    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      setRecordedBlob(blob);
      setRecordedUrl(URL.createObjectURL(blob));
      setRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    };

    mr.start(1000);
    setRecording(true);

    // Timer
    let seconds = 0;
    timerRef.current = setInterval(() => {
      seconds++;
      setRecordingTime(seconds);
      if (seconds === 80) setShowWarning(true);
      if (seconds >= 90) {
        mr.stop();
        if (timerRef.current) clearInterval(timerRef.current);
      }
    }, 1000);
  }

  function stopRecording() {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }

  function discardRecording() {
    setRecordedBlob(null);
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedUrl("");
    setRecordingTime(0);
    setShowWarning(false);
  }

  // ═══ UPLOAD TO SUPABASE ═══

  async function handleUpload() {
    const fileToUpload = selectedFile || (recordedBlob ? new File([recordedBlob], "intro.webm", { type: "video/webm" }) : null);
    if (!fileToUpload) return;

    setUploading(true);
    setUploadProgress(0);
    setError("");

    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError("Please sign in to continue."); setUploading(false); return; }

      const { data: candidate } = await supabase.from("candidates").select("id").eq("user_id", session.user.id).single();
      if (!candidate) { setError("Candidate not found."); setUploading(false); return; }

      const ext = selectedFile ? (selectedFile.name.split(".").pop()?.toLowerCase() || "mp4") : "webm";
      const filePath = `${candidate.id}/intro.${ext}`;

      // Simulate progress
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 8, 90));
      }, 300);

      const { error: uploadError } = await supabase.storage
        .from("video-intros")
        .upload(filePath, fileToUpload, { contentType: fileToUpload.type, upsert: true });

      clearInterval(progressInterval);

      if (uploadError) {
        setError("Upload failed: " + uploadError.message);
        setUploading(false);
        return;
      }

      setUploadProgress(95);

      // Save to API
      const res = await fetch("/api/candidate/video-intro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: filePath }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save video");
        setUploading(false);
        return;
      }

      setUploadProgress(100);
      setSuccess(true);
    } catch {
      setError("Something went wrong. Please try again.");
    }

    setUploading(false);
  }

  // ═══ INSTRUCTIONS PHASE ═══
  if (phase === "instructions") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="text-2xl font-bold text-text">Video Introduction</h1>
        <p className="mt-1 text-sm text-text-muted">
          A 30-90 second video that introduces you to potential clients. Candidates with a video introduction attract significantly more attention.
        </p>

        <div
          ref={instructionsRef}
          onScroll={handleScroll}
          className="mt-6 max-h-[60vh] overflow-y-auto"
        >
          {/* What to cover */}
          <div className="rounded-xl border border-border-light bg-card p-6">
            <h2 className="text-sm font-semibold text-text uppercase tracking-wider mb-4">What to Cover (In Order)</h2>
            <div className="space-y-4">
              {INSTRUCTIONS.map((item) => (
                <div key={item.num} className="flex gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                    {item.num}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-text">{item.title}</p>
                    <p className="mt-0.5 text-xs text-text-muted">{item.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tips accordion */}
          <div className="mt-4 space-y-2">
            {TIPS.map((tip, i) => (
              <div key={i} className="rounded-xl border border-border-light bg-card overflow-hidden">
                <button
                  onClick={() => setExpandedTip(expandedTip === i ? null : i)}
                  className="flex w-full items-center justify-between p-4 text-left"
                >
                  <span className="text-sm font-semibold text-text">{tip.title}</span>
                  <svg
                    className={`h-4 w-4 text-text-muted transition-transform ${expandedTip === i ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>
                {expandedTip === i && (
                  <div className="px-4 pb-4">
                    <ul className="space-y-1.5">
                      {tip.items.map((item, j) => (
                        <li key={j} className="flex items-start gap-2 text-xs text-text-muted">
                          <svg className="mt-0.5 h-3 w-3 shrink-0 text-primary" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" /></svg>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Spacer to ensure scrollability */}
          <div className="h-4" />
        </div>

        {/* Gate */}
        <div className="mt-6 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={guidelinesChecked}
              onChange={(e) => setGuidelinesChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <span className="text-xs text-text-muted">
              I have read the guidelines and understand only my first name may be used in this video.
            </span>
          </label>

          <button
            onClick={() => setPhase("upload")}
            disabled={!hasScrolledToBottom || !guidelinesChecked}
            className="w-full rounded-full bg-primary py-3 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Record or Upload Your Video Introduction
          </button>
        </div>
      </div>
    );
  }

  // ═══ SUCCESS STATE ═══
  if (success) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-text">Video Submitted</h1>
        <p className="mt-2 text-sm text-text-muted">
          Your video introduction is under review. We&apos;ll notify you within 24 hours once it&apos;s approved.
        </p>
        <Link
          href="/candidate/dashboard"
          className="mt-6 inline-block rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors"
        >
          Back to Dashboard
        </Link>
      </div>
    );
  }

  // ═══ UPLOAD PHASE ═══
  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-bold text-text">Record Your Video</h1>
      <p className="mt-1 text-sm text-text-muted">30-90 seconds. MP4 or MOV. Maximum 200MB.</p>

      {/* Tabs */}
      <div className="mt-6 flex rounded-lg border border-border-light overflow-hidden">
        <button
          onClick={() => setActiveTab("record")}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "record" ? "bg-primary text-white" : "bg-card text-text-muted hover:bg-gray-50"
          }`}
        >
          Record Now
        </button>
        <button
          onClick={() => setActiveTab("upload")}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "upload" ? "bg-primary text-white" : "bg-card text-text-muted hover:bg-gray-50"
          }`}
        >
          Upload a File
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-xl bg-red-50 border border-red-200 p-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* ═══ RECORD TAB ═══ */}
      {activeTab === "record" && (
        <div className="mt-6">
          {!cameraReady && !recordedUrl && (
            <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-gray-50 p-12">
              <svg className="h-12 w-12 text-text-tertiary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
              </svg>
              <p className="mt-3 text-sm text-text-muted">Record a video using your device camera</p>
              <button
                onClick={startCamera}
                className="mt-4 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors"
              >
                Enable Camera
              </button>
            </div>
          )}

          {cameraReady && !recordedUrl && (
            <div>
              <div className="relative rounded-xl overflow-hidden bg-black">
                <video ref={videoRef} muted playsInline className="w-full aspect-video object-cover" />
                {recording && (
                  <div className="absolute top-3 right-3 flex items-center gap-2 rounded-full bg-red-600 px-3 py-1">
                    <div className="h-2 w-2 rounded-full bg-white animate-pulse" />
                    <span className="text-xs font-bold text-white tabular-nums">
                      {Math.floor((90 - recordingTime) / 60)}:{String((90 - recordingTime) % 60).padStart(2, "0")}
                    </span>
                  </div>
                )}
                {showWarning && (
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-amber-500 px-4 py-1 text-xs font-semibold text-white">
                    10 seconds remaining
                  </div>
                )}
              </div>
              <div className="mt-4 flex justify-center gap-3">
                {!recording ? (
                  <button
                    onClick={startRecording}
                    className="rounded-full bg-red-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
                  >
                    Start Recording
                  </button>
                ) : (
                  <button
                    onClick={stopRecording}
                    className="rounded-full bg-charcoal px-6 py-2.5 text-sm font-semibold text-white hover:bg-gray-700 transition-colors"
                  >
                    Stop Recording
                  </button>
                )}
              </div>
            </div>
          )}

          {recordedUrl && (
            <div>
              <div className="rounded-xl overflow-hidden bg-black">
                <video src={recordedUrl} controls playsInline className="w-full aspect-video" />
              </div>
              <p className="mt-2 text-xs text-text-muted text-center">{recordingTime} seconds recorded</p>
              <div className="mt-4 flex justify-center gap-3">
                <button
                  onClick={discardRecording}
                  className="rounded-full border border-border px-5 py-2 text-sm text-text-muted hover:bg-gray-50 transition-colors"
                >
                  Record Again
                </button>
                <button
                  onClick={handleUpload}
                  disabled={uploading || recordingTime < 30}
                  className="rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-50"
                >
                  {uploading ? "Uploading..." : "Use This Video"}
                </button>
              </div>
              {recordingTime < 30 && (
                <p className="mt-2 text-xs text-red-600 text-center">
                  Your video must be at least 30 seconds. Please record again.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══ UPLOAD TAB ═══ */}
      {activeTab === "upload" && (
        <div className="mt-6">
          {!selectedFile ? (
            <div
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const file = e.dataTransfer.files[0];
                if (file) handleFileSelect(file);
              }}
              className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-gray-50 p-12 cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = "video/mp4,video/quicktime,.mp4,.mov";
                input.onchange = (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (file) handleFileSelect(file);
                };
                input.click();
              }}
            >
              <svg className="h-12 w-12 text-text-tertiary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <p className="mt-3 text-sm font-medium text-text">Drop your video here or click to browse</p>
              <p className="mt-1 text-xs text-text-tertiary">MP4 or MOV &middot; 30-90 seconds &middot; Max 200MB</p>
            </div>
          ) : (
            <div>
              <div className="rounded-xl overflow-hidden bg-black">
                <video src={previewUrl} controls playsInline className="w-full aspect-video" />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-text-muted">
                <span>{selectedFile.name}</span>
                <span>{duration}s &middot; {(selectedFile.size / (1024 * 1024)).toFixed(1)}MB</span>
              </div>
              <div className="mt-4 flex justify-center gap-3">
                <button
                  onClick={() => { setSelectedFile(null); setPreviewUrl(""); setDuration(0); }}
                  className="rounded-full border border-border px-5 py-2 text-sm text-text-muted hover:bg-gray-50 transition-colors"
                >
                  Choose Different File
                </button>
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark transition-colors disabled:opacity-50"
                >
                  {uploading ? "Uploading..." : "Upload Video"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Progress bar */}
      {uploading && (
        <div className="mt-4">
          <div className="h-2 w-full rounded-full bg-gray-100">
            <div
              className="h-2 rounded-full bg-primary transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-text-muted text-center">{uploadProgress}% uploaded</p>
        </div>
      )}
    </div>
  );
}
