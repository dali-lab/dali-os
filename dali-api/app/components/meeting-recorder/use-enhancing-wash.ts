import { useEffect, useState } from "react";
import { DUR, prefersReducedMotion } from "./motion";
import { findBlock } from "./block-dom";
import { useBlockStyleRules } from "./block-style-rules";
import { washCss } from "./enhance-rules";
import type { SnapshotBlock } from "./enhance-plan";

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
  const [wash, setWash] = useState<{ id: string | null; tick: number }>({ id: null, tick: 0 });
  useBlockStyleRules("wash", washCss(wash.id, wash.tick % 2 === 0 ? "a" : "b"));

  useEffect(() => {
    const root = active ? getRoot() : null;
    if (!root || prefersReducedMotion()) return;
    const ids = typedBlockIds(getBlocks()).filter((id) => findBlock(root, id) !== null);
    if (ids.length === 0) return;

    let current = 0;
    let tick = 0;
    setWash({ id: ids[0]!, tick });
    const timer = setInterval(() => {
      current = (current + 1) % ids.length;
      tick += 1;
      setWash({ id: ids[current]!, tick });
    }, DUR.wash);

    return () => {
      clearInterval(timer);
      setWash({ id: null, tick: 0 });
    };
  }, [active]);
}
