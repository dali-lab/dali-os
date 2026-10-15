import { runPool } from "~/lib/run-pool";

export const MAX_CONCURRENT_UPLOADS = 3;

const MAX_NAMES_LISTED = 3;

export type UploadFailure = { name: string; error: string };
export type UploadProgress = { done: number; total: number; failed: UploadFailure[] };

export function listNames(failed: UploadFailure[]): string {
  const shown = failed.slice(0, MAX_NAMES_LISTED).map((f) => f.name);
  const rest = failed.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}

/** One line for an inline error banner after a batch; null when nothing failed. */
export function summarizeFailures(failed: UploadFailure[], total: number): string | null {
  if (failed.length === 0) return null;
  if (total === 1) return failed[0].error;
  return `${failed.length} of ${total} files failed: ${listNames(failed)}`;
}

/**
 * Uploads every file with bounded concurrency, carrying on past failures, and
 * resolves with the ones that failed. `onSettled` fires after each file ends.
 */
export async function uploadAll(
  files: File[],
  uploadOne: (file: File) => Promise<void>,
  onSettled?: (progress: UploadProgress) => void,
): Promise<UploadFailure[]> {
  const failed: UploadFailure[] = [];
  let done = 0;
  await runPool(files, MAX_CONCURRENT_UPLOADS, async (file) => {
    try {
      await uploadOne(file);
    } catch (err) {
      failed.push({ name: file.name, error: err instanceof Error ? err.message : "Upload failed" });
    }
    done += 1;
    onSettled?.({ done, total: files.length, failed: [...failed] });
  });
  return failed;
}
