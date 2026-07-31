// Public API of the shared doc-editor package.
//
// Import weight: DocEditor itself is SSR-safe and chunk-light (the BlockNote
// stack loads lazily in the browser — see DocEditor.tsx). buildSchema and the
// slash/mention/schema modules DO pull @blocknote/* into the importing chunk;
// only import those from client-side code that already renders an editor.

// THE component.
export { DocEditor, DocEditorFallback } from "./DocEditor";
export type { DocEditorProps, DocCollabConfig } from "./types";

// Capability model (pure).
export {
  EDITOR_PRESETS,
  resolveFeatures,
  hasSigning,
  type Features,
  type EditorPresetName,
} from "./features";

// Signing context + authoring insert helpers.
export {
  SigningContext,
  DEFAULT_SIGNING_CTX,
  type SigningContextValue,
  type SigningMode,
} from "./signing-context";
export { insertSigningField, insertVariable, type InsertSigningFieldOpts } from "./insert";

// Schema factory + editor/document types (heavy — client-only imports).
export {
  buildSchema,
  type DocSchema,
  type DocEditorInstance,
  type DocBlock,
  type DocPartialBlock,
} from "./schema/build";

// Pure block-tree helpers (safe anywhere, including server loaders).
export {
  countWords,
  extractHeadings,
  looksLikeProseMirrorDoc,
  normalizeInitialContent,
  type TocHeading,
} from "./blocks-util";

// Upload pipeline (client).
export { uploadEditorImage, rawUploadUrl, IMAGE_UPLOAD_ACCEPT } from "./upload";

// Shared schema configs contract (pure; also consumed by server codecs).
export * from "./schema/configs";
