import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { History } from "lucide-react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import {
  ySyncPlugin,
  ySyncPluginKey,
  yCursorPlugin,
  yUndoPlugin,
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
} from "y-prosemirror";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { IndexeddbPersistence } from "y-indexeddb";
import {
  ACTIVITY_THROTTLE_MS,
  IDLE_AFTER_MS,
  IDLE_CHECK_MS,
  type AwarenessUser,
  getCollabUrl,
  nameToColor,
} from "./collab/util";
import { useRegisterCollabEditor } from "./collab/PresenceProvider";
import { VersionHistoryPanel } from "./collab/VersionHistoryPanel";

interface CollaborativeEditorProps {
  documentName: string;
  token: string;
  userName: string;
  userColor?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /**
   * Stable id for this editor within the surrounding <PresenceProvider>.
   * Used to route page-level avatar clicks back to the right editor for
   * follow-mode. If unset, the editor still works but won't participate in
   * the page-level presence bar.
   */
  editorId?: string;

  /**
   * Inline-comment support (opt-in). When provided, a floating "Comment"
   * button appears on a non-empty text selection; clicking it encodes the
   * selected range to Yjs relative positions and calls onRequestComment so the
   * host can persist a DocComment with that anchor. `commentAnchors` are the
   * existing anchors to highlight; clicking a comment in the rail can call the
   * imperative `focusAnchor` exposed via onReady.
   */
  inlineComments?: InlineCommentOpts;
}

export type CommentAnchor = { from: string; to: string };

export type InlineCommentOpts = {
  enabled: boolean;
  // Persisted anchors to render as highlights, keyed by comment id.
  anchors: { id: string; anchor: CommentAnchor }[];
  // User selected text and clicked Comment; host opens its composer.
  onRequestComment: (anchor: CommentAnchor) => void;
  // Hands the host an imperative scroll-to-anchor fn once the editor mounts.
  onReady?: (api: { focusAnchor: (anchor: CommentAnchor) => void }) => void;
};

const commentDecoKey = new PluginKey("inlineCommentDecorations");

// Custom cursor/selection builders so we can add an `.idle` class — the
// default builders don't know about our `idle` flag.
function buildCursor(user: AwarenessUser, _clientId: number): HTMLElement {
  const cursor = document.createElement("span");
  cursor.classList.add("ProseMirror-yjs-cursor");
  if (user.idle) cursor.classList.add("idle");
  cursor.setAttribute("style", `border-color: ${user.color}`);
  const label = document.createElement("div");
  label.setAttribute("style", `background-color: ${user.color}`);
  label.appendChild(document.createTextNode(user.name));
  cursor.appendChild(document.createTextNode("\u2060"));
  cursor.appendChild(label);
  cursor.appendChild(document.createTextNode("\u2060"));
  return cursor;
}

// Default builder appends a hex alpha (`${color}70`); our hsl colors break
// it. Pass color via CSS var so color-mix() in the stylesheet can apply
// alpha regardless of format.
function buildSelection(user: AwarenessUser) {
  return {
    class: `ProseMirror-yjs-selection${user.idle ? " idle" : ""}`,
    style: `--yjs-user-color: ${user.color}`,
  };
}

// Wraps the raw y-prosemirror plugins directly. The official Tiptap
// collaboration wrappers (@tiptap/y-tiptap) use a different plugin key than
// y-prosemirror, which breaks the cursor extension.
function createCollabExtension(
  fragment: Y.XmlFragment,
  provider: HocuspocusProvider,
) {
  return Extension.create({
    name: "yCollab",
    addProseMirrorPlugins() {
      return [
        ySyncPlugin(fragment),
        yCursorPlugin(provider.awareness!, {
          cursorBuilder: buildCursor as any,
          selectionBuilder: buildSelection as any,
        }),
        yUndoPlugin(),
      ];
    },
  });
}

// Highlights persisted inline-comment ranges. Reads anchors via a getter so the
// host can update them without rebuilding the editor; a meta on the comment key
// forces a recompute. Decorations are derived from Yjs relative positions
// resolved against the live doc, so they track the right text as it moves.
function createCommentDecorationExtension(
  ydoc: Y.Doc,
  fragment: Y.XmlFragment,
  getAnchors: () => { id: string; anchor: { from: string; to: string } }[],
) {
  return Extension.create({
    name: "inlineCommentDecorations",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: commentDecoKey,
          state: {
            init: () => DecorationSet.empty,
            apply(tr, old, _oldState, newState) {
              if (!tr.docChanged && !tr.getMeta(commentDecoKey)) return old;
              const binding = ySyncPluginKey.getState(newState)?.binding;
              if (!binding) return DecorationSet.empty;
              const decos: Decoration[] = [];
              for (const { id, anchor } of getAnchors()) {
                const from = decodeAbsolute(ydoc, fragment, binding, anchor.from);
                const to = decodeAbsolute(ydoc, fragment, binding, anchor.to);
                if (from == null || to == null || from >= to) continue;
                decos.push(
                  Decoration.inline(from, to, {
                    class: "inline-comment-highlight",
                    "data-comment-id": id,
                  }),
                );
              }
              return DecorationSet.create(newState.doc, decos);
            },
          },
          props: {
            decorations(state) {
              return commentDecoKey.getState(state);
            },
          },
        }),
      ];
    },
  });
}

// Encode an absolute ProseMirror position to a Yjs relative position string.
// Relative positions are stable across collaborative edits, so a comment
// anchored to one stays attached to the same text as others type around it.
function encodeRelative(
  ydoc: Y.Doc,
  fragment: Y.XmlFragment,
  binding: unknown,
  pos: number,
): string | null {
  try {
    const rel = absolutePositionToRelativePosition(pos, fragment, binding as never);
    return JSON.stringify(Array.from(Y.encodeRelativePosition(rel)));
  } catch {
    return null;
  }
}

function decodeAbsolute(
  ydoc: Y.Doc,
  fragment: Y.XmlFragment,
  binding: unknown,
  encoded: string,
): number | null {
  try {
    const rel = Y.decodeRelativePosition(Uint8Array.from(JSON.parse(encoded) as number[]));
    const abs = relativePositionToAbsolutePosition(ydoc, fragment, rel, binding as never);
    return abs ?? null;
  } catch {
    return null;
  }
}

// Module-level cache so StrictMode's double-mount reuses the same Y.Doc /
// provider — without it, the editor binds to one while the duplicate leaks,
// silently breaking sync.
interface DocEntry {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  fragment: Y.XmlFragment;
  persistence: IndexeddbPersistence;
  refCount: number;
  disposeTimer: ReturnType<typeof setTimeout> | null;
}

const docCache = new Map<string, DocEntry>();

function acquireDoc(documentName: string, token: string): DocEntry {
  const key = documentName;
  let entry = docCache.get(key);

  if (entry) {
    if (entry.disposeTimer) {
      clearTimeout(entry.disposeTimer);
      entry.disposeTimer = null;
    }
    entry.refCount++;
    return entry;
  }

  const ydoc = new Y.Doc();
  console.log(`[collab:${documentName}] Y.Doc created, clientID=${ydoc.clientID}`);

  // Local IndexedDB cache: doc loads instantly on reload, edits made offline
  // queue and replay when the WS reconnects.
  const persistence = new IndexeddbPersistence(documentName, ydoc);
  persistence.once("synced", () => {
    console.log(`[collab:${documentName}] indexeddb synced`);
  });

  const provider = new HocuspocusProvider({
    url: getCollabUrl(),
    name: documentName,
    document: ydoc,
    token,
  });

  const fragment = ydoc.getXmlFragment("default");
  entry = {
    ydoc,
    provider,
    fragment,
    persistence,
    refCount: 1,
    disposeTimer: null,
  };
  docCache.set(key, entry);
  return entry;
}

function releaseDoc(documentName: string) {
  const key = documentName;
  const entry = docCache.get(key);
  if (!entry) return;
  entry.refCount--;
  if (entry.refCount > 0) return;
  // Delay destroy so StrictMode unmount+remount reuses the same instance.
  entry.disposeTimer = setTimeout(() => {
    const current = docCache.get(key);
    if (!current || current.refCount > 0) return;
    console.log(`[collab:${documentName}] disposing`);
    current.provider.destroy();
    current.persistence.destroy();
    current.ydoc.destroy();
    docCache.delete(key);
  }, 500);
}

export function CollaborativeEditor(props: CollaborativeEditorProps) {
  const { documentName, token, disabled = false, className } = props;
  const [entry, setEntry] = useState<DocEntry | null>(null);

  useEffect(() => {
    const acquired = acquireDoc(documentName, token);
    setEntry(acquired);
    return () => {
      releaseDoc(documentName);
      setEntry(null);
    };
  }, [documentName, token]);

  // Don't mount the tiptap editor until the Y.Doc is ready. Tiptap v3's
  // `useEditor(options, deps)` with `immediatelyRender: false` does not
  // reliably propagate an `editable` option change when deps flip, which
  // leaves the editor stuck read-only even after the doc loads. Rendering an
  // inner component only after entry is set means `useEditor` is called once
  // with the final extensions + `editable: !disabled`, so the contenteditable
  // binding is correct from the start.
  if (!entry) {
    return (
      <div
        className={`relative rounded-lg border bg-white ${
          disabled
            ? "border-gray-200 bg-gray-50 opacity-75"
            : "border-gray-300"
        } ${className ?? ""}`}
      >
        <div className="min-h-[6rem] px-3 py-2 text-sm text-gray-400 italic">
          Loading editor…
        </div>
      </div>
    );
  }

  return <CollaborativeEditorInner {...props} entry={entry} />;
}

function CollaborativeEditorInner({
  documentName,
  userName,
  userColor,
  disabled = false,
  placeholder = "Start typing...",
  className,
  editorId,
  inlineComments,
  entry,
}: CollaborativeEditorProps & { entry: DocEntry }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Live inline-comment anchors, read by the decoration plugin's getter.
  const anchorsRef = useRef(inlineComments?.anchors ?? []);
  anchorsRef.current = inlineComments?.anchors ?? [];
  // Floating "Comment" button position (viewport coords) when a non-empty
  // selection exists; null hides it.
  const [commentBtn, setCommentBtn] = useState<{ top: number; left: number } | null>(null);
  const color = userColor ?? nameToColor(userName);
  // Read latest values inside the awareness effect without re-running it
  // on rename — that would trigger a setUser write and idle-timer churn.
  const userNameRef = useRef(userName);
  const colorRef = useRef(color);
  userNameRef.current = userName;
  colorRef.current = color;

  // The inner component only ever mounts client-side (after the outer
  // component's useEffect sets entry), so there's no SSR hydration concern
  // and we can let tiptap render synchronously.
  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    extensions: [
      StarterKit.configure({
        // Disable built-in undo/redo — yUndoPlugin provides collab-aware undo
        undoRedo: false,
      }),
      Placeholder.configure({ placeholder }),
      createCollabExtension(entry.fragment, entry.provider),
      ...(inlineComments?.enabled
        ? [
            createCommentDecorationExtension(
              entry.ydoc,
              entry.fragment,
              () => anchorsRef.current,
            ),
          ]
        : []),
    ],
    editable: !disabled,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none focus:outline-none min-h-[6rem] px-3 py-2",
      },
    },
  });

  // Diagnostic: confirm editable state after editor mounts
  useEffect(() => {
    if (editor) {
      console.log(
        `[collab:${documentName}] editor ready, editable=${editor.isEditable}, contenteditable=${editor.view.dom.contentEditable}`,
      );
    }
  }, [editor, documentName]);

  useEffect(() => {
    if (editor) editor.setEditable(!disabled);
  }, [editor, disabled]);

  // Inline comments: recompute decorations when the anchor list changes, show a
  // floating Comment button on non-empty selections, and expose focusAnchor.
  const onRequestComment = inlineComments?.onRequestComment;
  const onReadyRef = useRef(inlineComments?.onReady);
  onReadyRef.current = inlineComments?.onReady;

  useEffect(() => {
    if (!editor || !inlineComments?.enabled) return;
    // Force the decoration plugin to recompute against the new anchors.
    editor.view.dispatch(editor.view.state.tr.setMeta(commentDecoKey, true));
  }, [editor, inlineComments?.enabled, inlineComments?.anchors]);

  useEffect(() => {
    if (!editor || !inlineComments?.enabled) return;
    const update = () => {
      const { from, to, empty } = editor.state.selection;
      if (empty || disabled) {
        setCommentBtn(null);
        return;
      }
      const container = containerRef.current;
      if (!container) return;
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      const box = container.getBoundingClientRect();
      setCommentBtn({
        top: Math.min(start.top, end.top) - box.top - 30,
        left: (start.left + end.left) / 2 - box.left,
      });
    };
    editor.on("selectionUpdate", update);
    editor.on("blur", () => setTimeout(() => setCommentBtn(null), 150));
    return () => {
      editor.off("selectionUpdate", update);
    };
  }, [editor, inlineComments?.enabled, disabled]);

  useEffect(() => {
    if (!editor || !inlineComments?.enabled) return;
    onReadyRef.current?.({
      focusAnchor: (anchor) => {
        const binding = ySyncPluginKey.getState(editor.state)?.binding;
        if (!binding) return;
        const from = decodeAbsolute(entry.ydoc, entry.fragment, binding, anchor.from);
        if (from == null) return;
        editor.chain().focus().setTextSelection(from).scrollIntoView().run();
      },
    });
  }, [editor, entry, inlineComments?.enabled]);

  function requestCommentOnSelection() {
    if (!editor) return;
    const binding = ySyncPluginKey.getState(editor.state)?.binding;
    if (!binding) return;
    const { from, to } = editor.state.selection;
    const fromRel = encodeRelative(entry.ydoc, entry.fragment, binding, from);
    const toRel = encodeRelative(entry.ydoc, entry.fragment, binding, to);
    if (!fromRel || !toRel) return;
    setCommentBtn(null);
    onRequestComment?.({ from: fromRel, to: toRel });
  }

  // The editor's own awareness carries name/color/idle for inline cursor
  // labels. This is a separate awareness from the page-level presence (one
  // per content y-doc), so the idle timer here is not redundant with the
  // PresenceProvider's.
  useEffect(() => {
    const aw = entry.provider.awareness!;
    const setUser = (patch: Partial<AwarenessUser> = {}) => {
      const cur = (aw.getLocalState()?.user ?? {}) as Partial<AwarenessUser>;
      aw.setLocalStateField("user", {
        lastActive: Date.now(),
        idle: false,
        ...cur,
        ...patch,
        name: userNameRef.current,
        color: colorRef.current,
      } satisfies AwarenessUser);
    };
    setUser({ lastActive: Date.now(), idle: false });

    const idleTimer = setInterval(() => {
      const cur = (aw.getLocalState()?.user ?? {}) as AwarenessUser;
      const isIdle = Date.now() - (cur.lastActive ?? 0) > IDLE_AFTER_MS;
      if (isIdle !== !!cur.idle) setUser({ idle: isIdle });
    }, IDLE_CHECK_MS);

    // Bump lastActive on local editor activity so peer cursor labels can
    // recover from idle. yCursorPlugin already flushes cursor position on
    // every keystroke; we just need lastActive ticked periodically to keep
    // the idle flag in sync. The page-level keydown listener in
    // PresenceProvider only updates page awareness — not this per-doc one.
    let lastBump = 0;
    const bumpActive = () => {
      const now = Date.now();
      if (now - lastBump < ACTIVITY_THROTTLE_MS) return;
      lastBump = now;
      setUser({ lastActive: now, idle: false });
    };
    if (editor) {
      editor.on("update", bumpActive);
      editor.on("selectionUpdate", bumpActive);
      editor.on("focus", bumpActive);
    }

    return () => {
      clearInterval(idleTimer);
      if (editor) {
        editor.off("update", bumpActive);
        editor.off("selectionUpdate", bumpActive);
        editor.off("focus", bumpActive);
      }
    };
  }, [entry, editor]);

  // Resolve a peer's relative cursor position in this editor's y-doc to an
  // absolute ProseMirror position, then scroll to it.
  const followPeer = useCallback(
    (clientId: number) => {
      if (!editor || !entry) return;
      const state = entry.provider.awareness?.getStates().get(clientId) as
        | { cursor?: { head: unknown; anchor: unknown } }
        | undefined;
      if (!state?.cursor) return;
      const ystate = ySyncPluginKey.getState(editor.state) as
        | {
            doc: Y.Doc;
            type: Y.XmlFragment;
            binding: { mapping: Map<unknown, unknown> };
          }
        | undefined;
      if (!ystate) return;
      try {
        const pos = relativePositionToAbsolutePosition(
          ystate.doc,
          ystate.type,
          Y.createRelativePositionFromJSON(state.cursor.head),
          ystate.binding.mapping as never,
        );
        if (pos == null) return;
        const { node } = editor.view.domAtPos(pos);
        const el = node instanceof HTMLElement ? node : node.parentElement;
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch (err) {
        console.warn(`[collab:${documentName}] follow failed`, err);
      }
    },
    [editor, entry, documentName],
  );

  const scrollIntoView = useCallback(() => {
    containerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const presence = useRegisterCollabEditor({
    editorId: editorId ?? documentName,
    followPeer,
    scrollIntoView,
  });

  // Mark this as the user's currentEditor on focus. Throttle the report so
  // a click that fires both `focus` and `selectionUpdate` doesn't double-write.
  // Typing-based activity is already covered by the page-level keydown listener
  // in PresenceProvider, so no `update` handler needed here.
  const { enabled: presenceEnabled, reportFocus } = presence;
  useEffect(() => {
    if (!editor || !presenceEnabled) return;
    let lastFocusReport = 0;
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusReport < ACTIVITY_THROTTLE_MS) return;
      lastFocusReport = now;
      reportFocus();
    };
    editor.on("focus", onFocus);
    editor.on("selectionUpdate", onFocus);
    return () => {
      editor.off("focus", onFocus);
      editor.off("selectionUpdate", onFocus);
    };
  }, [editor, presenceEnabled, reportFocus]);

  return (
    <div
      ref={containerRef}
      className={`relative rounded-lg border bg-card ${
        disabled
          ? "border-border bg-muted/50 opacity-75"
          : "border-gray-300 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent"
      } ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={() => setHistoryOpen(true)}
        title="Version history"
        aria-label="Version history"
        className="absolute top-1.5 right-1.5 z-10 p-1 rounded text-muted-foreground/70 hover:text-foreground/80 hover:bg-muted transition-colors"
      >
        <History size={14} />
      </button>
      {historyOpen && (
        <VersionHistoryPanel
          documentName={documentName}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {inlineComments?.enabled && commentBtn && (
        <button
          type="button"
          onMouseDown={(e) => {
            // Keep the selection alive through the click.
            e.preventDefault();
            requestCommentOnSelection();
          }}
          style={{ top: commentBtn.top, left: commentBtn.left }}
          className="absolute z-20 -translate-x-1/2 px-2 py-1 rounded-md bg-foreground text-background text-xs font-medium shadow-lg whitespace-nowrap"
        >
          💬 Comment
        </button>
      )}
      <EditorContent editor={editor} />
      {/*
        y-prosemirror's default cursor builder renders:
          <span class="ProseMirror-yjs-cursor" style="border-color: {color}">
            <div style="background-color: {color}">{name}</div>
          </span>
        Without CSS, the inner <div> renders as a block element taking full
        line width. These styles make it a floating label above a thin caret,
        matching the Google Docs / Notion look. The .idle variants dim the
        cursor and selection when the peer has been inactive.
      */}
      <style>{`
        .ProseMirror-yjs-cursor {
          position: relative;
          margin-left: -1px;
          margin-right: -1px;
          border-left: 1.5px solid black;
          border-right: 1.5px solid black;
          word-break: normal;
          pointer-events: none;
          height: 1.2em;
          transition: opacity 0.3s;
        }
        .ProseMirror-yjs-cursor.idle {
          opacity: 0.35;
        }
        .ProseMirror-yjs-selection {
          background-color: color-mix(in srgb, var(--yjs-user-color) 30%, transparent);
          transition: background-color 0.3s;
        }
        .ProseMirror-yjs-selection.idle {
          background-color: color-mix(in srgb, var(--yjs-user-color) 10%, transparent);
        }
        .inline-comment-highlight {
          background-color: rgba(251, 191, 36, 0.28);
          border-bottom: 2px solid rgba(217, 119, 6, 0.6);
          cursor: pointer;
        }
        .ProseMirror-yjs-cursor > div {
          position: absolute;
          top: -1.45em;
          left: -2px;
          font-size: 0.7rem;
          font-weight: 600;
          font-family: inherit;
          line-height: 1.2;
          user-select: none;
          color: white;
          padding: 1px 6px;
          border-radius: 3px 3px 3px 0;
          white-space: nowrap;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}
