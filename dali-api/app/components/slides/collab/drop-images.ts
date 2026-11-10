import { placedElements, type Placed } from "~/components/slides/deck/freeform";
import type { RenderSlide } from "~/components/slides/deck/snapshot";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function imageFilesOf(data: Pick<DataTransfer, "files"> | null | undefined): File[] {
  return [...(data?.files ?? [])].filter((f) => IMAGE_TYPES.has(f.type));
}

export function hasFiles(data: Pick<DataTransfer, "types"> | null | undefined): boolean {
  return [...(data?.types ?? [])].includes("Files");
}

const contains = (p: Placed, at: { x: number; y: number }) => at.x >= p.x && at.x <= p.x + p.w && at.y >= p.y && at.y <= p.y + p.h;

/** The free image under a point, topmost first. Slot images are replaced through their own picker. */
export function imageUnder(slide: RenderSlide, at: { x: number; y: number }): string | null {
  const hit = placedElements(slide)
    .filter((i) => i.element.kind === "image" && i.element.slot === null && !i.element.locked && contains(i.placed, at))
    .pop();
  return hit?.element.id ?? null;
}

export interface DropPlan {
  file: File;
  at: { x: number; y: number };
  replaceId: string | null;
}

/** One entry per image: the first replaces the image it lands on, if any; the rest are added, stepped down and right. */
export function planDrop(slide: RenderSlide, files: File[], at: { x: number; y: number }, step = 40): DropPlan[] {
  const target = imageUnder(slide, at);
  return files.map((file, i) => ({
    file,
    at: { x: at.x + i * step, y: at.y + i * step },
    replaceId: i === 0 ? target : null,
  }));
}
