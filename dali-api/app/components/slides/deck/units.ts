import type { CSSProperties } from "react";
import type { SlotRect } from "./layouts";

/** A length on the 1920 wide stage. `--slide-u` is one stage unit in screen pixels, set on the stage root. */
export const u = (n: number): string => `calc(${n} * var(--slide-u))`;

export function rectStyle(rect: SlotRect): CSSProperties {
  return { position: "absolute", left: u(rect.x), top: u(rect.y), width: u(rect.w), height: u(rect.h) };
}

/** A rect plus the rotation about its center that the slide draws it with. */
export function placedStyle(placed: SlotRect & { rot?: number }): CSSProperties {
  return { ...rectStyle(placed), ...(placed.rot ? { transform: `rotate(${placed.rot}deg)` } : {}) };
}
