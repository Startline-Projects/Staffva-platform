/**
 * Upload queue with retry logic for Supabase Storage.
 * Retries up to 3 times with 10-second delays.
 * Never fails silently — always returns clear error.
 */

import { createClient } from "@/lib/supabase/client";

export interface UploadResult {
  success: boolean;
  path?: string;
  error?: string;
  attempts: number;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 10000; // 10 seconds

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upload a file to Supabase Storage with retry queue.
 */
export async function uploadWithRetry(
  bucket: string,
  filePath: string,
  file: Blob | File,
  contentType?: string
): Promise<UploadResult> {
  const supabase = createClient();
  let lastError = "";

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const options: { contentType?: string; upsert?: boolean } = { upsert: true };
      if (contentType) options.contentType = contentType;

      const { error } = await supabase.storage
        .from(bucket)
        .upload(filePath, file, options);

      if (!error) {
        return {
          success: true,
          path: filePath,
          attempts: attempt,
        };
      }

      lastError = error.message;

      // If it's a conflict (file exists), try upsert
      if (error.message.includes("already exists")) {
        const { error: upsertError } = await supabase.storage
          .from(bucket)
          .update(filePath, file, options);

        if (!upsertError) {
          return {
            success: true,
            path: filePath,
            attempts: attempt,
          };
        }
        lastError = upsertError.message;
      }

      // Don't retry on auth errors
      if (error.message.includes("not authorized") || error.message.includes("JWT")) {
        return {
          success: false,
          error: `Authentication error: ${error.message}. Please refresh the page and try again.`,
          attempts: attempt,
        };
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Network error";
    }

    // Wait before retry (except on last attempt)
    if (attempt < MAX_RETRIES) {
      await delay(RETRY_DELAY_MS);
    }
  }

  return {
    success: false,
    error: `Upload failed after ${MAX_RETRIES} attempts: ${lastError}. Please check your internet connection and try again.`,
    attempts: MAX_RETRIES,
  };
}

/**
 * Upload multiple files concurrently with individual retry queues.
 */
export async function uploadBatchWithRetry(
  uploads: { bucket: string; filePath: string; file: Blob | File; contentType?: string }[]
): Promise<UploadResult[]> {
  return Promise.all(
    uploads.map((u) => uploadWithRetry(u.bucket, u.filePath, u.file, u.contentType))
  );
}
