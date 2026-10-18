import { useEffect } from "react";
import { DUR, prefersReducedMotion } from "./motion";
import { findBlock } from "./block-dom";
import type { SnapshotBlock } from "./enhance-plan";

export const WASH_ATTR = "data-enhance-wash";

export function typedBlockIds(blocks: readonly SnapshotBlock[]): string[] {
  return blocks.filter((b) => b.type !== "heading" && b.text.trim() !== "").map((b) => b.id);
}

export function useEnhancingWash({
  active,
  getRoot,
  getBlocks,
}: {
  active: boolean;
  getRoot: () => HTMLElement | null;
  getBlocks: () => readonly SnapshotBlock[];
}) {
  useEffect(() => {
    const root = active ? getRoot() : null;
    if (!root || prefersReducedMotion()) return;
    const els = typedBlockIds(getBlocks())
      .map((id) => findBlock(root, id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;

    let current = 0;
    function show() {
      els.forEach((el, i) => el.setAttribute(WASH_ATTR, i === current ? "active" : ""));
    }
    show();
    const timer = setInterval(() => {
      current = (current + 1) % els.length;
      show();
    }, DUR.wash);

    return () => {
      clearInterval(timer);
      for (const el of els) el.removeAttribute(WASH_ATTR);
    };
  }, [active]);
}
