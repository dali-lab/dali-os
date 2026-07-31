// Public prop types for DocEditor. Runtime-light on purpose: the heavy schema
// types come in via `import type` (erased at build time), so importing this
// module — or the DocEditor wrapper — never pulls BlockNote into a route's
// server/entry chunk.

import type { TocHeading } from "./blocks-util";
import type { Features, EditorPresetName } from "./features";
import type { DocBlock, DocPartialBlock } from "./schema/build";
import type { SigningContextValue } from "./signing-context";

export interface DocCollabConfig {
  /** Hocuspocus room name (e.g. Page.contentDocId ?? pageDocName(pageId)). */
  documentName: string;
  /** Collab auth token — the raw session cookie value (session id). */
  token: string;
  /** Display name for remote cursors / awareness. */
  userName: string;
  /** User.id — carried on awareness for presence dedupe / profile links. */
  userId?: string;
}

export interface DocEditorProps {
  /** Capability set or preset name. Default: {} (the "field" preset). */
  features?: Features | EditorPresetName;
  /** Default true. Signing fill/view surfaces pass false — fields stay
   * interactive via the signing context even when the body is read-only. */
  editable?: boolean;
  /** "compact" drops the side menu + block gutter for short structured inputs;
   * "full" (default) is the document surface. */
  density?: "compact" | "full";
  /** Extra classes on the outer wrapper (surfaces own their chrome). */
  className?: string;
  /** Shown when the document is empty. Per-block "type / for commands" hints
   * keep BlockNote's defaults. */
  placeholder?: string;
  /** Fires on every content change with the full block tree (local mode and
   * collab mode alike; collab persistence stays server-side). */
  onChange?: (blocks: DocBlock[]) => void;
  /**
   * Initial document for LOCAL (non-collab) mode. Accepts BlockNote blocks;
   * anything else — including legacy ProseMirror JSON ({type:"doc"}) — renders
   * empty with a console.warn. Server loaders own PM→BlockNote conversion.
   * Ignored in collab mode (the Y.Doc is the source of truth).
   */
  initialContent?: DocPartialBlock[] | unknown;
  /** Presence of this prop switches the editor to collaborative mode. */
  collab?: DocCollabConfig;
  /** Fired (throttled) with the live body word count as content changes. */
  onWordCountChange?: (count: number) => void;
  /** Fired (throttled) with the H1–H3 outline as content changes. */
  onHeadingsChange?: (headings: TocHeading[]) => void;
  /** Signing context (mode/signerRole/variables/values/onFieldChange) for
   * surfaces with features.signing. Defaults to view mode. */
  signing?: SigningContextValue;
}
