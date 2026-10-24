import { useEffect, useRef, useState } from "react";

/** One in-flight write per cell. Keep local edits through loader revalidation,
 * and flush on blur/unmount (term changes, filters, or moving to Later). */
export function usePlannerAutosave<T>(
  initial: T,
  save: (value: T) => Promise<void>,
  onError: () => void,
) {
  const [value, setValue] = useState(initial);
  const latest = useRef(initial);
  const saved = useRef(initial);
  const running = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacks = useRef({ save, onError });
  callbacks.current = { save, onError };

  useEffect(() => {
    if (!running.current && latest.current === saved.current) {
      latest.current = saved.current = initial;
      setValue(initial);
    }
  }, [initial]);

  async function flush() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (running.current) return;
    running.current = true;
    try {
      while (latest.current !== saved.current) {
        const next = latest.current;
        await callbacks.current.save(next);
        saved.current = next;
      }
    } catch {
      // Leave the draft dirty so the next edit or blur can retry it.
      callbacks.current.onError();
    } finally {
      running.current = false;
    }
  }

  useEffect(() => () => { void flush(); }, []);

  function change(next: T) {
    latest.current = next;
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 500);
  }

  return { value, change, flush };
}
