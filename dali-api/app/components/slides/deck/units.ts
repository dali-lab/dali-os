import type { CSSProperties } from "react";
import type { SlotRect } from "./layouts";

/** A length on the 1920 wide stage. `--slide-u` is one stage unit in screen pixels, set on the stage root. */
export const u = (n: number): string => `calc(${n} * var(--slide-u))`;

export function rectStyle(rect: SlotRect): CSSProperties {
  return { position: "absolute", left: u(rect.x), top: u(rect.y), width: u(rect.w), height: u(rect.h) };
}
