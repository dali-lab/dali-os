import { useCallback, useEffect, useRef, useState } from "react";
import {
  PROGRESS_DEBOUNCE_MS,
  clearProgress,
  getProgressStorage,
  loadProgress,
  progressKey,
  saveProgress,
} from "~/forms/lib/form-progress";

export function useFormProgress({
  enabled,
  token,
  versionId,
  versionUpdatedAt,
  userId,
  answers,
  pageIndex,
  onRestore,
}: {
  enabled: boolean;
  token: string;
  versionId: string;
  versionUpdatedAt: string;
  userId: string | null;
  answers: Record<string, string>;
  pageIndex: number;
  onRestore: (saved: { answers: Record<string, string>; pageIndex: number }) => void;
}) {
  const key = progressKey(token, versionId, userId);
  const [restored, setRestored] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const saved = loadProgress(getProgressStorage(), key, versionUpdatedAt);
    if (!saved) return;
    onRestoreRef.current({ answers: saved.answers, pageIndex: saved.pageIndex });
    setRestored(true);
  }, [enabled, key, versionUpdatedAt]);

  useEffect(() => {
    if (!enabled) return;
    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      saveProgress(getProgressStorage(), key, { answers, pageIndex, versionUpdatedAt });
    }, PROGRESS_DEBOUNCE_MS);
    return cancel;
  }, [enabled, key, versionUpdatedAt, answers, pageIndex, cancel]);

  const clear = useCallback(() => {
    cancel();
    clearProgress(getProgressStorage(), key);
    setRestored(false);
  }, [cancel, key]);

  return { restored, clear };
}
