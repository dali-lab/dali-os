import { useLayoutEffect, useState, type RefObject } from "react";

/** Scale factor that fits content designed at `baseWidth` into the element's current width. */
export function useScaleToFit(ref: RefObject<HTMLElement | null>, baseWidth: number): number {
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / baseWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, baseWidth]);
  return scale;
}
