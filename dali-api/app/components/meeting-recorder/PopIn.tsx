import { useEffect, useRef, type ReactNode } from "react";
import { animate, DUR, POP_FRAMES } from "./motion";

export function useEnter<T extends HTMLElement>(frames: Keyframe[], ms: number, opts: { delay?: number; enabled?: boolean } = {}) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (opts.enabled === false) return;
    const handle = animate(ref.current, frames, ms, { delay: opts.delay });
    return () => handle.cancel();
  }, []);
  return ref;
}

export function PopIn({
  delay = 0,
  from = 0.9,
  ms = DUR.chip,
  enabled = true,
  className,
  children,
}: {
  delay?: number;
  from?: number;
  ms?: number;
  enabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useEnter<HTMLDivElement>(POP_FRAMES(from), ms, { delay, enabled });
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
