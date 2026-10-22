import { useEffect, useState } from 'react';

/** The current time, re-read every `intervalMs` while `active`. */
export function useNow(intervalMs: number, active = true): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, active]);
  return now;
}
