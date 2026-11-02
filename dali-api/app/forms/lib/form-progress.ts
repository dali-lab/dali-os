export const PROGRESS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const PROGRESS_DEBOUNCE_MS = 500;

export type SavedProgress = {
  answers: Record<string, string>;
  pageIndex: number;
  versionUpdatedAt: string;
  savedAt: number;
};

export type ProgressStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function progressKey(token: string, versionId: string, userId: string | null): string {
  return `form-progress:${token}:${versionId}:${userId ?? "anon"}`;
}

export function getProgressStorage(): ProgressStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function hasAnswers(answers: Record<string, string>): boolean {
  return Object.values(answers).some((v) => v.trim() !== "" && v !== "[]");
}

function parse(raw: string, versionUpdatedAt: string, now: number): SavedProgress | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<SavedProgress>;
  if (v.versionUpdatedAt !== versionUpdatedAt) return null;
  if (typeof v.savedAt !== "number" || now - v.savedAt > PROGRESS_MAX_AGE_MS) return null;
  if (!v.answers || typeof v.answers !== "object" || Array.isArray(v.answers)) return null;
  if (!Object.values(v.answers).every((a) => typeof a === "string")) return null;
  const pageIndex =
    typeof v.pageIndex === "number" && Number.isInteger(v.pageIndex) && v.pageIndex > 0
      ? v.pageIndex
      : 0;
  return { answers: v.answers, pageIndex, versionUpdatedAt, savedAt: v.savedAt };
}

// Returns the saved copy, or null when there is none, it is for another
// version of the form, or it has expired. Unusable copies are removed.
export function loadProgress(
  storage: ProgressStorage | null,
  key: string,
  versionUpdatedAt: string,
  now: number = Date.now(),
): SavedProgress | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const saved = parse(raw, versionUpdatedAt, now);
    if (!saved) storage.removeItem(key);
    return saved;
  } catch {
    return null;
  }
}

export function saveProgress(
  storage: ProgressStorage | null,
  key: string,
  progress: { answers: Record<string, string>; pageIndex: number; versionUpdatedAt: string },
  now: number = Date.now(),
): void {
  if (!storage || !hasAnswers(progress.answers)) return;
  try {
    const value: SavedProgress = { ...progress, savedAt: now };
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Blocked or full storage just means no saving.
  }
}

export function clearProgress(storage: ProgressStorage | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Nothing saved that we could remove.
  }
}
