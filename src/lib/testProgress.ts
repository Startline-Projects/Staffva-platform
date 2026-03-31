/**
 * Hybrid localStorage + database sync for English test progress.
 * All writes go to localStorage first. Background sync writes to DB every 60s
 * and on section completion. On load, checks localStorage first, falls back to DB.
 */

import { createClient } from "@/lib/supabase/client";

const LS_KEY = "staffva_test_progress";

export interface TestProgress {
  candidateId: string;
  section: string;
  questionIndex: number;
  answers: Record<string, number>;
  timerRemaining: number;
  isMobile: boolean;
  recordingStatus?: string;
  updatedAt: string;
}

// ─── localStorage operations ───

export function saveProgressLocal(progress: TestProgress): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(progress));
  } catch {
    // localStorage full or unavailable — silent
  }
}

export function loadProgressLocal(): TestProgress | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TestProgress;
  } catch {
    return null;
  }
}

export function clearProgressLocal(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    // silent
  }
}

// ─── Database sync ───

export async function syncProgressToDb(progress: TestProgress): Promise<boolean> {
  try {
    const supabase = createClient();
    const { error } = await supabase
      .from("application_progress")
      .upsert(
        {
          candidate_id: progress.candidateId,
          section: progress.section,
          question_index: progress.questionIndex,
          answers: progress.answers,
          timer_remaining: progress.timerRemaining,
          recording_status: progress.recordingStatus || null,
          is_mobile: progress.isMobile,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "candidate_id" }
      );

    return !error;
  } catch {
    return false;
  }
}

export async function loadProgressFromDb(candidateId: string): Promise<TestProgress | null> {
  try {
    const supabase = createClient();
    const { data } = await supabase
      .from("application_progress")
      .select("*")
      .eq("candidate_id", candidateId)
      .single();

    if (!data) return null;

    return {
      candidateId: data.candidate_id,
      section: data.section,
      questionIndex: data.question_index,
      answers: data.answers || {},
      timerRemaining: data.timer_remaining || 0,
      isMobile: data.is_mobile || false,
      recordingStatus: data.recording_status || undefined,
      updatedAt: data.updated_at,
    };
  } catch {
    return null;
  }
}

export async function clearProgressFromDb(candidateId: string): Promise<void> {
  try {
    const supabase = createClient();
    await supabase
      .from("application_progress")
      .delete()
      .eq("candidate_id", candidateId);
  } catch {
    // silent
  }
}

// ─── Hybrid load: localStorage first, then DB ───

export async function loadProgress(candidateId: string): Promise<TestProgress | null> {
  // Check localStorage first
  const local = loadProgressLocal();
  if (local && local.candidateId === candidateId) {
    return local;
  }

  // Fall back to database
  return loadProgressFromDb(candidateId);
}

// ─── Background sync manager ───

let syncInterval: ReturnType<typeof setInterval> | null = null;

export function startBackgroundSync(getProgress: () => TestProgress | null, intervalMs: number = 60000): void {
  stopBackgroundSync();

  syncInterval = setInterval(() => {
    const progress = getProgress();
    if (progress) {
      syncProgressToDb(progress);
    }
  }, intervalMs);
}

export function stopBackgroundSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

// ─── Mobile detection ───

export function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) ||
    (typeof window !== "undefined" && window.innerWidth < 768);
}

export function supportsFullscreen(): boolean {
  if (typeof document === "undefined") return false;
  return !!(
    document.documentElement.requestFullscreen ||
    (document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void }).webkitRequestFullscreen ||
    (document.documentElement as HTMLElement & { msRequestFullscreen?: () => void }).msRequestFullscreen
  );
}
