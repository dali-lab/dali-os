// Per-page display prefs stored on Page.typography (Notion's Style section).
// Shared by the documents loader (normalizing the raw Json column), the
// typography API route (validation mirror), and DocumentEditor (rendering).

export interface PageTypography {
  font: "default" | "serif" | "mono";
  smallText: boolean;
  fullWidth: boolean;
  // BlockNote's vertical indent guides on nested blocks. Off by default —
  // Notion draws none; deep-outline pages can opt in.
  nestingGuides: boolean;
}

export const DEFAULT_TYPOGRAPHY: PageTypography = {
  font: "default",
  smallText: false,
  fullWidth: false,
  nestingGuides: false,
};

/** Normalize the raw Json column value; anything malformed → defaults. */
export function normalizePageTypography(raw: unknown): PageTypography {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_TYPOGRAPHY;
  }
  const o = raw as Record<string, unknown>;
  return {
    font: o.font === "serif" || o.font === "mono" ? o.font : "default",
    smallText: o.smallText === true,
    fullWidth: o.fullWidth === true,
    nestingGuides: o.nestingGuides === true,
  };
}
