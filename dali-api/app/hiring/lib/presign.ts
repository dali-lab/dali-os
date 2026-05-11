import type { Question } from "~/types";
import { getDownloadUrl } from "~/lib/s3";

// Replace raw S3 keys for `file`-type answers with short-lived presigned
// download URLs so reviewer-side viewers can render real download links.
// Non-file answers and missing/empty values pass through untouched. If
// presigning throws (e.g. transient S3 error), the raw key is preserved so
// the loader still returns something the UI can render.
export async function presignAnswers(
  questions: Question[],
  answers: Record<string, string>,
): Promise<Record<string, string>> {
  const result = { ...answers };
  for (const q of questions) {
    if (q.type === "file" && answers[q.key]?.trim()) {
      try {
        result[q.key] = await getDownloadUrl(answers[q.key], 900);
      } catch {
        // Keep the raw key so the UI still has *something* to render.
      }
    }
  }
  return result;
}
