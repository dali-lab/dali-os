// Capability model for the shared DocEditor — successor of the legacy
// EditorFeatures/EDITOR_PRESETS in app/components/editor/presets.ts, with the
// same feature keys and preset names so surface ports are mechanical.
//
// Pure data (no React, no BlockNote): safe to import anywhere, including
// server loaders that need to decide a surface's capabilities.

export interface Features {
  /** "@" typeahead + mention chips (stored {id, label}). */
  mentions?: boolean;
  /** Image block + paste/drop/file-panel upload to S3. */
  images?: boolean;
  /** File + video blocks — doc attachments, embedded video player. */
  files?: boolean;
  /** Rich extras: callout, table, toggle list — and their slash-menu items. */
  richBlocks?: boolean;
  /**
   * Signing field family + merge variables. Boolean here only gates the schema
   * (the nodes must be registered on EVERY surface that reads a signing body,
   * or they're stripped on load); mode/values/variables ride on DocEditor's
   * `signing` prop. The legacy structured form ({roles, variables, values}) is
   * accepted for compatibility and coerced to `true` by resolveFeatures.
   */
  signing?: boolean | Record<string, unknown>;
}

export type EditorPresetName = "field" | "notes" | "agreement" | "guide" | "document";

export const EDITOR_PRESETS: Record<EditorPresetName, Features> = {
  field: {}, // short structured input
  notes: { images: true }, // mentorship notes/templates, hiring notes
  agreement: { images: true, signing: true }, // signing document body
  guide: { mentions: true, images: true, files: true }, // page-doc guides
  document: { mentions: true, images: true, files: true, richBlocks: true }, // full document
};

export function resolveFeatures(input: EditorPresetName | Features | undefined): Features {
  if (input === undefined) return {};
  return typeof input === "string" ? EDITOR_PRESETS[input] : input;
}

/** Signing is structurally-typed for legacy compat; normalize to a boolean. */
export function hasSigning(features: Features): boolean {
  return Boolean(features.signing);
}
