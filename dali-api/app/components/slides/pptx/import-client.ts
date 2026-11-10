import { mapPresentation, type ParsedPresentation } from "./import-map";
import { skippedTotal, SKIPPED_LABELS, type ImportPlan, type ReadyFree, type ReadySlide, type SkippedKind } from "./import-types";

export const MAX_PPTX_BYTES = 50 * 1024 * 1024;
export const MAX_PPTX_SLIDES = 300;
export const PPTX_ACCEPT = ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation";

const PPTX_TYPES = new Set(["", "application/octet-stream", "application/vnd.openxmlformats-officedocument.presentationml.presentation"]);
const UPLOAD_WORKERS = 4;

export function validatePptxFile(file: { name: string; size: number; type: string }): string | null {
  if (!/\.pptx$/i.test(file.name) || !PPTX_TYPES.has(file.type)) return "Choose a PowerPoint file that ends in .pptx.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_PPTX_BYTES) return `That file is larger than ${MAX_PPTX_BYTES / (1024 * 1024)} MB.`;
  return null;
}

export class PptxImportError extends Error {}

/** Reads a .pptx in the browser and maps it to deck slides. Images stay inline as data URLs until `uploadImages` replaces them. */
export async function parsePptxFile(file: File): Promise<ImportPlan> {
  const { parse } = await import("pptxtojson");
  let parsed: ParsedPresentation;
  try {
    parsed = await parse(await file.arrayBuffer(), { imageMode: "base64", videoMode: "none", audioMode: "none" });
  } catch {
    throw new PptxImportError("That file couldn't be read. Check that it's a PowerPoint presentation.");
  }
  if (parsed.slides.length === 0) throw new PptxImportError("That presentation doesn't have any slides.");
  if (parsed.slides.length > MAX_PPTX_SLIDES) throw new PptxImportError(`That presentation has more than ${MAX_PPTX_SLIDES} slides.`);
  return mapPresentation(parsed);
}

function dataUrlToFile(dataUrl: string, name: string): File | null {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const [, mime, base64, payload] = match;
  const binary = base64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ext = mime.split("/")[1]?.replace("jpeg", "jpg").replace("svg+xml", "svg") ?? "png";
  return new File([bytes], `${name}.${ext}`, { type: mime });
}

export interface UploadedPlan {
  slides: ReadySlide[];
  skipped: ImportPlan["skipped"];
}

/** Uploads each slide image through `upload` and keeps only the returned URL. A failed upload leaves the slide without its image and counts it. */
export async function uploadImages(
  plan: ImportPlan,
  upload: (file: File) => Promise<string>,
  onProgress?: (done: number, total: number) => void,
): Promise<UploadedPlan> {
  const skipped = { ...plan.skipped };
  const unique = new Map<string, Promise<string | null>>();
  const jobs = plan.slides.flatMap((s) => [...(s.image ? [s.image] : []), ...(s.free ?? []).flatMap((f) => (f.kind === "image" ? [f] : []))]);
  const total = new Set(jobs.map((j) => j.dataUrl)).size;
  let done = 0;
  const queue = jobs.filter((job, i) => jobs.findIndex((j) => j.dataUrl === job.dataUrl) === i);

  const run = async (job: (typeof jobs)[number]) => {
    const file = dataUrlToFile(job.dataUrl, job.name);
    const url = file ? await upload(file).catch(() => null) : null;
    done++;
    onProgress?.(done, total);
    return url;
  };
  const workers = Array.from({ length: Math.min(UPLOAD_WORKERS, queue.length) }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const pending = run(job);
      unique.set(job.dataUrl, pending);
      await pending;
    }
  });
  await Promise.all(workers);

  const slides: ReadySlide[] = [];
  for (const slide of plan.slides) {
    const { image, free, ...rest } = slide;
    const src = image ? await unique.get(image.dataUrl) : null;
    if (image && !src) skipped.image = (skipped.image ?? 0) + 1;
    const ready: ReadyFree[] = [];
    for (const item of free ?? []) {
      if (item.kind !== "image") {
        ready.push(item);
        continue;
      }
      const url = await unique.get(item.dataUrl);
      if (url) ready.push({ kind: "image", placed: item.placed, src: url, alt: item.alt });
      else skipped.image = (skipped.image ?? 0) + 1;
    }
    slides.push({ ...rest, image: image && src ? { src, alt: image.alt } : null, ...(free ? { free: ready } : {}) });
  }
  return { slides, skipped };
}

export function importSummary(added: number, skipped: ImportPlan["skipped"]): string {
  const added_ = `Added ${added} ${added === 1 ? "slide" : "slides"}.`;
  const total = skippedTotal(skipped);
  if (total === 0) return added_;
  const kinds = (Object.keys(skipped) as SkippedKind[])
    .filter((k) => (skipped[k] ?? 0) > 0)
    .map((k) => `${skipped[k]} ${SKIPPED_LABELS[k]}`)
    .join(", ");
  return `${added_} ${total} ${total === 1 ? "item" : "items"} couldn't be imported (${kinds}).`;
}
