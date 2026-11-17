import { useEffect, useRef } from "react";
import { isInFloatingLayer } from "./outside";

/** Calls `onDismiss` on a mousedown outside `insideSelector` and outside every floating layer, and on Escape when asked. */
export function useOutsideDismiss(
  active: boolean,
  insideSelector: string,
  onDismiss: () => void,
  { escape = false }: { escape?: boolean } = {},
) {
  const latest = useRef(onDismiss);
  latest.current = onDismiss;
  useEffect(() => {
    if (!active) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest?.(insideSelector) || isInFloatingLayer(target)) return;
      latest.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") latest.current();
    };
    document.addEventListener("mousedown", onMouseDown);
    if (escape) document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [active, insideSelector, escape]);
}
