import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { animate, canAnimate, DUR } from "./motion";

export type BarContent = { key: string; node: ReactNode } | null;

export function BarTransition({ content }: { content: BarContent }) {
  const [shown, setShown] = useState<BarContent>(content);
  const frame = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const settled = useRef<string | null>(content?.key ?? null);
  const pending = useRef<{ cancel: () => void } | null>(null);
  const contentKey = content?.key ?? null;
  const latest = useRef(content);
  latest.current = content;

  useLayoutEffect(() => {
    pending.current?.cancel();
    pending.current = null;
    const current = latest.current;
    if (current && shown && shown.key === current.key) return;

    if (!canAnimate(frame.current) || !shown) {
      setShown(current);
      return;
    }

    if (!current) {
      const height = frame.current.offsetHeight;
      const collapse = animate(
        frame.current,
        [
          { height: `${height}px`, opacity: 1, overflow: "hidden" },
          { height: "0px", opacity: 0, overflow: "hidden" },
        ],
        DUR.barResize,
        { fill: "forwards" },
      );
      pending.current = collapse;
      void collapse.then(() => {
        if (pending.current === collapse) setShown(latest.current);
      });
      return;
    }

    const fadeOut = animate(inner.current, [{ opacity: 1 }, { opacity: 0 }], DUR.swapOut, { fill: "forwards" });
    pending.current = fadeOut;
    void fadeOut.then(() => {
      if (pending.current === fadeOut) setShown(latest.current);
    });
  }, [contentKey]);

  useLayoutEffect(() => {
    const key = shown?.key ?? null;
    const before = settled.current;
    settled.current = key;
    if (key === null || key === before) return;
    if (before === null) {
      const height = frame.current?.scrollHeight ?? 0;
      void animate(
        frame.current,
        [
          { height: "0px", opacity: 0, overflow: "hidden" },
          { height: `${height}px`, opacity: 1, overflow: "hidden" },
        ],
        DUR.barResize,
      );
      return;
    }
    void animate(
      inner.current,
      [
        { opacity: 0, transform: `translateY(${DUR.swapRisePx}px)` },
        { opacity: 1, transform: "none" },
      ],
      DUR.swapIn,
    );
  }, [shown?.key]);

  if (!shown) return null;
  const node = content && content.key === shown.key ? content.node : shown.node;
  return (
    <div ref={frame}>
      <div ref={inner} key={shown.key}>
        {node}
      </div>
    </div>
  );
}
