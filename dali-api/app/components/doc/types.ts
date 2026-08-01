// Public prop types for DocEditor. Runtime-light on purpose: the heavy schema
// types come in via `import type` (erased at build time), so importing this
// module — or the DocEditor wrapper — never pulls BlockNote into a route's
// server/entry chunk.

import type React from "react";
import type { TocHeading } from "./blocks-util";
import type { Features, EditorPresetName } from "./features";
import type { DocBlock, DocEditorInstance, DocPartialBlock } from "./schema/build";
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

/** Wires BlockNote's CommentsExtension for inline commenting.
 * Passed by DocumentEditor for pages; omitted on all other surfaces. */
export interface DocCommentsConfig {
  /** The Page id — used as DocComment.targetId. */
  pageId: string;
  /** The current user's id — drives auth rules in ThreadStoreAuth. */
  currentUserId: string;
  /** Whether the viewer may post new comments / replies. */
  canComment: boolean;
  /** Whether the viewer may resolve / reopen threads. */
  canResolve: boolean;
  /** Whether the comments panel is currently open (W2 uses for sidebar sync). */
  panelOpen?: boolean;
  /** The DOM id of the comments panel — BlockNote anchors jump to it. */
  panelTargetId?: string;
  /** Which thread filter to apply to the ThreadsSidebar portal — mirrors the
   * panel's Open/Resolved tab so the inline sidebar matches the active tab. */
  panelFilter?: "open" | "resolved";
  /** When true, the right-hand rail is visible; FloatingThreadController is
   * suppressed and the rail handles thread selection display instead. */
  railVisible?: boolean;
  /** DOM id of the rail container div owned by DocumentEditor. */
  railTargetId?: string;
  /** Ref to the paper card element (mark measurement + resize watch). */
  editorContentRef?: React.RefObject<HTMLElement | null>;
  /** Called when the rail's Open/Resolved filter changes. */
  onRailFilterChange?: (filter: "open" | "resolved") => void;
  /** Deep-linked comment id (?comment=) for the rail to select once loaded. */
  focusCommentId?: string;
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
  /** Fires with the live editor instance whenever it's (re)created — hosts
   * that drive imperative helpers (insertSigningField/insertVariable) capture
   * it here. The instance is invalid after the editor unmounts/remounts; the
   * callback fires again with the replacement. */
  onEditorReady?: (editor: DocEditorInstance) => void;
  /** When provided, wires BlockNote's inline comment system for this doc.
   * Other surfaces omit this prop — no comments feature is enabled. */
  comments?: DocCommentsConfig;
  /** When true, the find/replace ProseMirror plugin is registered on the
   * editor. The host (DocumentEditor) owns open/close state; toggling this
   * prop registers or unregisters the decoration plugin accordingly. */
  findOpen?: boolean;
  /**
   * Per-surface opt-in for the AI assistant (/ai slash item + "Edit with AI"
   * toolbar button). The env half of the gate (does the server have a provider
   * key?) is read from the root meta tag inside the editor — hosts just pass
   * true on surfaces where AI belongs. Never opt in on external-facing
   * (applicant/partner) or signing surfaces.
   */
  aiEnabled?: boolean;
}
