// The public project write-up as structured data: ordered { item, description }
// pairs plus an image/video gallery. This replaced a free-text collab document
// so the public API ships data and dali.website owns every bit of formatting
// (the card grid, the bold heading, the pen-emoji callout are all the site's).
//
// Stored in ProjectShowcase.details / .media as JSONB. Pure (no DB import) so
// it's unit-testable and safe to import from both server loaders and the
// client editor — the shapes below are the contract all four callers share:
// the public API, the public-view loader, the editor action, and the backfill.

export type ShowcaseDetail = {
  // The card heading, e.g. "The Problem". Plain text — the site adds the colon,
  // weight, and layout.
  item: string;
  // The blurb shown inside the card.
  description: string;
};

export type ShowcaseMediaType = "image" | "video";

export type ShowcaseMedia = {
  type: ShowcaseMediaType;
  // An S3 key under `uploads/` (served through the media proxy) or a full URL,
  // the same storage rule heroImageUrl follows.
  src: string;
  caption?: string;
};

// Seeds the editor when a showcase has no details yet — the three sections
// every DALI write-up has carried. Descriptions start empty; they're prompts,
// not content, so the public API filters them out until they're filled in.
export const DEFAULT_DETAILS: ShowcaseDetail[] = [
  { item: "The Problem", description: "" },
  { item: "Our Solution", description: "" },
  { item: "The Impact", description: "" },
];

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// Normalize the JSONB column into a clean array. Drops rows that are blank on
// both fields (the editor's empty trailing row, an unfilled default prompt) so
// neither the form nor the public site renders an empty card. Anything the
// column can't be read as an array degrades to [].
export function parseDetails(value: unknown): ShowcaseDetail[] {
  if (!Array.isArray(value)) return [];
  const out: ShowcaseDetail[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const item = asString((entry as Record<string, unknown>).item).trim();
    const description = asString((entry as Record<string, unknown>).description).trim();
    if (item === "" && description === "") continue;
    out.push({ item, description });
  }
  return out;
}

export function parseMedia(value: unknown): ShowcaseMedia[] {
  if (!Array.isArray(value)) return [];
  const out: ShowcaseMedia[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const src = asString(rec.src).trim();
    if (src === "") continue;
    const type: ShowcaseMediaType = rec.type === "video" ? "video" : "image";
    const caption = asString(rec.caption).trim();
    out.push(caption ? { type, src, caption } : { type, src });
  }
  return out;
}
