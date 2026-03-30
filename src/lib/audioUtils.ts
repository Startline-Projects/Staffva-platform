/**
 * Audio validation, compression, and preview generation utilities
 * for the StaffVA voice recording flow.
 */

export interface AudioValidationResult {
  valid: boolean;
  error?: string;
  duration: number;
  fileSize: number;
}

/**
 * Validate audio blob — checks minimum duration and file size.
 */
export async function validateAudio(
  blob: Blob,
  minDurationSeconds: number = 15,
  minFileSizeBytes: number = 10240 // 10KB
): Promise<AudioValidationResult> {
  const fileSize = blob.size;

  if (fileSize < minFileSizeBytes) {
    return {
      valid: false,
      error: `Recording appears to be empty or silent (${(fileSize / 1024).toFixed(1)}KB). Please ensure your microphone is working and try again.`,
      duration: 0,
      fileSize,
    };
  }

  // Get duration by loading into an audio element
  const duration = await getAudioDuration(blob);

  if (duration < minDurationSeconds) {
    return {
      valid: false,
      error: `Recording is too short (${Math.floor(duration)} seconds). Minimum ${minDurationSeconds} seconds required.`,
      duration,
      fileSize,
    };
  }

  return { valid: true, duration, fileSize };
}

/**
 * Get audio duration from a blob.
 */
export function getAudioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = "metadata";

    audio.onloadedmetadata = () => {
      // Chrome sometimes returns Infinity for webm
      if (audio.duration === Infinity || isNaN(audio.duration)) {
        // Fallback: estimate from file size (webm ~16kbps = 2KB/s)
        const estimated = blob.size / 2048;
        URL.revokeObjectURL(audio.src);
        resolve(estimated);
      } else {
        URL.revokeObjectURL(audio.src);
        resolve(audio.duration);
      }
    };

    audio.onerror = () => {
      URL.revokeObjectURL(audio.src);
      // Fallback estimate
      resolve(blob.size / 2048);
    };

    audio.src = URL.createObjectURL(blob);
  });
}

/**
 * Compress audio using AudioContext re-encoding.
 * Targets 128kbps max bitrate via webm/opus.
 */
export async function compressAudio(blob: Blob): Promise<Blob> {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Create offline context for re-encoding
    const offlineCtx = new OfflineAudioContext(
      1, // mono
      audioBuffer.length,
      audioBuffer.sampleRate > 48000 ? 48000 : audioBuffer.sampleRate
    );

    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);

    const renderedBuffer = await offlineCtx.startRendering();

    // Re-encode to webm/opus at lower bitrate using MediaRecorder
    const mediaStream = audioBufferToMediaStream(renderedBuffer);
    const compressed = await mediaStreamToBlob(mediaStream, 128000);

    audioContext.close();

    // Only use compressed if it's actually smaller
    return compressed.size < blob.size ? compressed : blob;
  } catch {
    // If compression fails, return original
    return blob;
  }
}

/**
 * Convert AudioBuffer to MediaStream for re-encoding.
 */
function audioBufferToMediaStream(buffer: AudioBuffer): MediaStream {
  const audioContext = new AudioContext();
  const source = audioContext.createBufferSource();
  source.buffer = buffer;

  const dest = audioContext.createMediaStreamDestination();
  source.connect(dest);
  source.start(0);

  return dest.stream;
}

/**
 * Record a MediaStream to a Blob using MediaRecorder.
 */
function mediaStreamToBlob(
  stream: MediaStream,
  audioBitsPerSecond: number
): Promise<Blob> {
  return new Promise((resolve) => {
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus",
      audioBitsPerSecond,
    });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: "audio/webm" }));
    };

    recorder.start();

    // Stop when the source stream ends
    const track = stream.getAudioTracks()[0];
    if (track) {
      track.onended = () => recorder.stop();
      // Safety timeout — max 3 minutes
      setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 180000);
    } else {
      setTimeout(() => recorder.stop(), 1000);
    }
  });
}

/**
 * Generate a 15-second preview clip from the beginning of an audio blob.
 */
export async function generatePreviewClip(
  blob: Blob,
  previewDurationSeconds: number = 15
): Promise<Blob> {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const previewLength = Math.min(
      previewDurationSeconds * audioBuffer.sampleRate,
      audioBuffer.length
    );

    const offlineCtx = new OfflineAudioContext(
      1,
      previewLength,
      audioBuffer.sampleRate > 48000 ? 48000 : audioBuffer.sampleRate
    );

    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);

    const previewBuffer = await offlineCtx.startRendering();
    const stream = audioBufferToMediaStream(previewBuffer);
    const previewBlob = await mediaStreamToBlob(stream, 96000);

    audioContext.close();
    return previewBlob;
  } catch {
    // If preview generation fails, return the first chunk of the original
    return blob.slice(0, Math.min(blob.size, 100000));
  }
}

/**
 * Create an object URL for playback confirmation.
 */
export function createPlaybackUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

/**
 * Clean up an object URL.
 */
export function revokePlaybackUrl(url: string): void {
  URL.revokeObjectURL(url);
}
