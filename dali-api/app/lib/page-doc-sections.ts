import { randomBytes } from "node:crypto";

// Ordered guide sections stored on PageDoc.sections (JSON). Each sidebar entry
// has its own title, ProseMirror body, and optional walkthrough video.

export type StoredPageDocSection = {
  id: string;
  title: string;
  body: unknown | null;
  videoKey: string | null;
};

export function newSectionId(): string {
  return `sec_${randomBytes(8).toString("hex")}`;
}

export function parseStoredSections(raw: unknown): StoredPageDocSection[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredPageDocSection[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : newSectionId();
    const title =
      typeof row.title === "string" && row.title.trim() ? row.title.trim() : "Untitled";
    const videoKey =
      typeof row.videoKey === "string" && row.videoKey.trim() ? row.videoKey.trim() : null;
    out.push({
      id,
      title,
      body: row.body ?? null,
      videoKey,
    });
  }
  return out;
}

/** Prefer stored sections; otherwise synthesize one Overview from legacy fields. */
export function resolveSections(doc: {
  title: string;
  body: unknown;
  videoKey: string | null;
  sections: unknown;
}): StoredPageDocSection[] {
  const stored = parseStoredSections(doc.sections);
  if (stored.length > 0) return stored;
  return [
    {
      id: "overview",
      title: "Overview",
      body: doc.body ?? null,
      videoKey: doc.videoKey,
    },
  ];
}

/** Normalize a client-submitted sections payload, merging videoKey with prior. */
export function mergeSectionsPayload(
  incoming: unknown,
  prior: StoredPageDocSection[],
): StoredPageDocSection[] | { error: string } {
  if (!Array.isArray(incoming)) return { error: "sections must be an array" };
  if (incoming.length === 0) return { error: "Add at least one section." };
  if (incoming.length > 30) return { error: "Too many sections (max 30)." };

  const priorById = new Map(prior.map((s) => [s.id, s]));
  const out: StoredPageDocSection[] = [];

  for (const item of incoming) {
    if (!item || typeof item !== "object") {
      return { error: "Each section must be an object." };
    }
    const row = item as Record<string, unknown>;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    if (!title) return { error: "Every section needs a title." };
    if (title.length > 120) return { error: "Section titles must be under 120 characters." };

    const id =
      typeof row.id === "string" && row.id.trim() ? row.id.trim() : newSectionId();
    const prev = priorById.get(id);

    // videoKey: undefined → keep prior; null → clear; string → set.
    let videoKey: string | null;
    if (!("videoKey" in row)) {
      videoKey = prev?.videoKey ?? null;
    } else if (row.videoKey === null) {
      videoKey = null;
    } else if (typeof row.videoKey === "string" && row.videoKey.trim()) {
      videoKey = row.videoKey.trim();
      if (videoKey.length > 500) return { error: "Invalid video key." };
    } else {
      return { error: "Invalid videoKey on a section." };
    }

    out.push({
      id,
      title,
      body: "body" in row ? (row.body ?? null) : (prev?.body ?? null),
      videoKey,
    });
  }

  return out;
}
