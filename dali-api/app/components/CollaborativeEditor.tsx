import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { Extension, Node as TiptapNode, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import {
  History,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Image as ImageIcon,
  Baseline,
  Highlighter,
  AlignJustify,
  ChevronDown,
  Check,
  ListCollapse,
  GripVertical,
  Plus,
} from "lucide-react";
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
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
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
import { EDITOR_CONTENT_CLASS, EditorShell } from "./editor/shared";
import { mentionEditorExtension, searchMentionableUsers } from "./editor/mention";
import { imageEditorExtensions, uploadEditorImage, IMAGE_UPLOAD_ACCEPT } from "./editor/image";
import { richBlockExtensions } from "./editor/blocks";
import { slashCommandExtension } from "./editor/slash-menu";
import { BubbleToolbar } from "./editor/BubbleToolbar";

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

  /**
   * Enable the @-mention typeahead + mention nodes in the body (project
   * documents, guides). Off by default. NOTE: this adds a `mention` node to the
   * ProseMirror schema for this collab room — additive, but all clients on the
   * room should run with it enabled so the schema stays consistent.
   */
  enableMentions?: boolean;

  /**
   * Enable images in the body (paste/drop/toolbar upload → S3, inserted by
   * stable URL). Off by default. Same caveat as enableMentions: this adds an
   * `image` node to the ProseMirror schema for this collab room — additive,
   * but all clients on the room should run with it enabled so the schema
   * stays consistent.
   */
  enableImages?: boolean;

  /**
   * Enable rich block content + Notion-style editing affordances: tables, task
   * lists, callouts, a "/" slash-insert menu, a selection bubble toolbar, and
   * block drag handles. Off by default. Adds `table`/`taskList`/`taskItem`/
   * `callout` nodes to the collab room's schema — additive, but (like
   * enableMentions/enableImages) all clients on the room must run with it on, so
   * only turn it on for a surface where every client ships together.
   */
  enableRichBlocks?: boolean;

  /**
   * Drop the bordered "card" chrome (border, rounded corners, card background,
   * focus ring) so the editor reads as the page itself rather than a box on it.
   * Used by the full-page document surface. The toolbar keeps its own bottom
   * border as a subtle separator.
   */
  chromeless?: boolean;

  /**
   * When set (arriving from a mention notification), once the doc syncs the
   * editor scrolls to the first mention node tagging this user id and briefly
   * flashes it. No-op if that user isn't mentioned.
   */
  focusMentionUserId?: string;

  /**
   * Read/edit mode: when the editor is `disabled` (read mode) but the viewer
   * *could* edit, passing this makes the body a clean reading view that flips
   * to edit on the first click/keystroke. The host wires this to its edit-mode
   * state (e.g. setEditMode(true)). When set, the read-mode body is rendered
   * without the dimmed "no access" styling.
   */
  onBeginEdit?: () => void;

  /** Fired (throttled) with the live body word count as content changes. */
  onWordCountChange?: (count: number) => void;

  /** Fired (throttled) with the H1–H3 outline as content changes (for a ToC). */
  onHeadingsChange?: (headings: TocHeading[]) => void;

  /** Handed an imperative API once the editor mounts (e.g. scroll to a heading). */
  onReady?: (api: EditorApi) => void;
}

export type CommentAnchor = { from: string; to: string };

// One entry in the document outline. `ordinal` is the heading's 0-based index
// among all H1–H3 headings, used to re-resolve its live position on click
// (positions shift as the doc changes, so we never cache a raw pos).
export type TocHeading = { level: number; text: string; ordinal: number };

export type EditorApi = {
  scrollToHeading: (ordinal: number) => void;
};

export type InlineCommentOpts = {
  enabled: boolean;
  // Persisted anchors to render as highlights, keyed by comment id.
  anchors: { id: string; anchor: CommentAnchor }[];
  // User selected text and clicked Comment; host opens its composer.
  onRequestComment: (anchor: CommentAnchor) => void;
  // Hands the host an imperative scroll-to-anchor fn once the editor mounts.
  onReady?: (api: { focusAnchor: (anchor: CommentAnchor) => void }) => void;
  // Clicking an existing highlight opens a small popover right next to the
  // text (Google-Docs-style) instead of making the user scroll down to the
  // comments rail. The host renders the thread; we just position it and own
  // open/close state. `close` lets the host's content (e.g. a resolve/delete
  // button) dismiss the popover itself. Returning null renders nothing.
  getThreadNode?: (id: string, close: () => void) => ReactNode | null;
};

const commentDecoKey = new PluginKey("inlineCommentDecorations");

// In a contenteditable ProseMirror editor, Tab is not bound by default, so the
// browser treats it as focus traversal and moves focus out of the editor — to
// the user it looks like Tab "can't be typed." Bind it: inside a list, Tab/
// Shift-Tab indent/outdent the item (the Notion/Docs behavior); anywhere else
// Tab inserts a literal tab character. Returning true in every branch stops the
// focus-escape default.
const TabKeymap = Extension.create({
  name: "tabKeymap",
  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        if (editor.can().sinkListItem("listItem")) {
          return editor.chain().focus().sinkListItem("listItem").run();
        }
        return editor.chain().focus().insertContent("\t").run();
      },
      "Shift-Tab": ({ editor }) => {
        if (editor.can().liftListItem("listItem")) {
          return editor.chain().focus().liftListItem("listItem").run();
        }
        // Nothing to outdent outside a list; swallow it so focus stays put.
        return true;
      },
    };
  },
});

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
            apply(tr, old, oldState, newState) {
              if (!tr.docChanged && !tr.getMeta(commentDecoKey)) return old;
              // Read the binding off `oldState`, not `newState`: ProseMirror
              // builds plugin state fields on `newState` one at a time in
              // plugin-registration order, so mid-construction it may not
              // have reached the y-sync plugin's field yet. `oldState` is
              // already fully settled, and the binding instance itself is
              // stable across transactions, so it's always safe to read.
              const binding = ySyncPluginKey.getState(oldState)?.binding;
              if (!binding) return DecorationSet.empty;
              const decos: Decoration[] = [];
              for (const { id, anchor } of getAnchors()) {
                const from = decodeAbsolute(ydoc, fragment, binding.mapping, anchor.from);
                const to = decodeAbsolute(ydoc, fragment, binding.mapping, anchor.to);
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
  mapping: Map<unknown, unknown>,
  pos: number,
): string | null {
  try {
    // absolutePositionToRelativePosition wants the binding's `mapping` (a Map),
    // not the ProsemirrorBinding itself — passing the binding silently threw
    // here (swallowed by this catch), so "comment on selection" never fired.
    const rel = absolutePositionToRelativePosition(pos, fragment, mapping as never);
    return JSON.stringify(Array.from(Y.encodeRelativePosition(rel)));
  } catch {
    return null;
  }
}

function decodeAbsolute(
  ydoc: Y.Doc,
  fragment: Y.XmlFragment,
  mapping: Map<unknown, unknown>,
  encoded: string,
): number | null {
  try {
    const rel = Y.decodeRelativePosition(Uint8Array.from(JSON.parse(encoded) as number[]));
    const abs = relativePositionToAbsolutePosition(ydoc, fragment, rel, mapping as never);
    return abs ?? null;
  } catch {
    return null;
  }
}

// Markdown shortcuts (# , **, etc.) still work via StarterKit's input rules —
// they convert typed syntax into real formatting as you type, same as
// Notion/Google Docs. This toolbar is the mouse-driven equivalent for the
// same set of marks/nodes, so formatting doesn't require knowing the syntax.
// ─── Block-level line spacing ───────────────────────────────────────────────
// The bundled @tiptap LineHeight sets its value on the inline textStyle mark,
// which doesn't change actual block line spacing. We instead store an optional
// `lineHeight` attribute directly on paragraph/heading nodes and set it across
// the selected blocks. It defaults to null, so this is an additive change to
// the collaborative schema — existing docs parse unchanged.
const LINE_SPACING_TYPES = ["paragraph", "heading"];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    lineSpacing: {
      setLineHeight: (lineHeight: string) => ReturnType;
      unsetLineHeight: () => ReturnType;
    };
  }
}

const LineSpacing = Extension.create({
  name: "lineSpacing",
  addGlobalAttributes() {
    return [
      {
        types: LINE_SPACING_TYPES,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element) => element.style.lineHeight || null,
            renderHTML: (attributes) =>
              attributes.lineHeight
                ? { style: `line-height: ${attributes.lineHeight}` }
                : {},
          },
        },
      },
    ];
  },
  addCommands() {
    const apply =
      (lineHeight: string | null) =>
      ({ tr, state, dispatch }: { tr: Transaction; state: EditorState; dispatch?: (tr: Transaction) => void }) => {
        const { from, to } = state.selection;
        let changed = false;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (LINE_SPACING_TYPES.includes(node.type.name)) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, lineHeight });
            changed = true;
          }
        });
        if (changed && dispatch) dispatch(tr);
        return changed;
      };
    return {
      setLineHeight: (lineHeight: string) => apply(lineHeight),
      unsetLineHeight: () => apply(null),
    };
  },
});

// ─── Collapsible "toggle" block (Notion-style dropdown) ─────────────────────
// A container node whose first child is an editable summary line and whose
// remaining children are block content that visually collapses via an `open`
// attribute. Collapse is display-only (the body stays in the document) so
// collaborative sync isn't affected by open/closed state.
//
// The content model is `toggleSummary? block+` — the summary is *optional* on
// purpose: toggle blocks created before this change live in production Yjs docs
// with only `block+` content, and an optional first child means ProseMirror
// never auto-inserts a summary into them on load. That avoids every client
// racing to mutate the shared doc (which would risk duplicate inserts). New
// toggles seed an empty summary via setToggleBlock; legacy ones simply show the
// "Toggle" placeholder until a user adds one.
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    toggleBlock: {
      setToggleBlock: () => ReturnType;
    };
  }
}

// Editable one-line title for a toggle. `inline*` so it holds rich text but no
// block content; `isolating` keeps Enter/Backspace from merging it into the
// body region; not in the `block` group so it can only ever be a toggle's first
// child, never a free-floating block.
const ToggleSummary = TiptapNode.create({
  name: "toggleSummary",
  content: "inline*",
  defining: true,
  selectable: false,
  isolating: true,
  parseHTML() {
    return [{ tag: "summary" }, { tag: "div[data-type='toggle-summary']" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "toggle-summary" }),
      0,
    ];
  },
  addKeyboardShortcuts() {
    return {
      // Enter in the summary jumps into the body instead of splitting the
      // summary into a second line (Notion behavior). The body's first block
      // always exists (block+), so its content start is right after the summary.
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parent.type.name !== "toggleSummary") return false;
        const afterSummary = $from.after();
        return editor.chain().setTextSelection(afterSummary + 1).scrollIntoView().run();
      },
    };
  },
});

const ToggleBlock = TiptapNode.create({
  name: "toggleBlock",
  group: "block",
  content: "toggleSummary? block+",
  defining: true,
  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-open") !== "false",
        renderHTML: (attrs) => ({ "data-open": attrs.open ? "true" : "false" }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-type='toggle-block']" }, { tag: "details" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "toggle-block" }),
      0,
    ];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement("div");
      dom.className = "toggle-block";
      // Chevron sits outside contentDOM (a nodeView has exactly one contentDOM,
      // which must hold the node's content). CSS positions it in the gutter.
      const chevron = document.createElement("button");
      chevron.type = "button";
      chevron.className = "toggle-block__chevron";
      chevron.contentEditable = "false";
      chevron.setAttribute("aria-label", "Collapse or expand section");
      chevron.textContent = "▶";
      const content = document.createElement("div");
      content.className = "toggle-block__content";

      // data-open drives collapse; data-summary-empty drives the "Toggle"
      // placeholder over an empty (or absent, for legacy nodes) summary. Both
      // are CSS-only so open/close and empty state never touch the document.
      const sync = (n: typeof node) => {
        dom.dataset.open = n.attrs.open ? "true" : "false";
        const summary = n.firstChild;
        const summaryEmpty =
          !summary || summary.type.name !== "toggleSummary" || summary.content.size === 0;
        dom.dataset.summaryEmpty = summaryEmpty ? "true" : "false";
      };
      sync(node);

      chevron.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof getPos !== "function") return;
        const pos = getPos();
        if (pos == null) return;
        const cur = editor.state.doc.nodeAt(pos);
        const next = !(cur?.attrs.open ?? true);
        editor
          .chain()
          .command(({ tr }) => {
            tr.setNodeAttribute(pos, "open", next);
            return true;
          })
          .run();
      });

      dom.appendChild(chevron);
      dom.appendChild(content);
      return {
        dom,
        contentDOM: content,
        update: (updated) => {
          if (updated.type.name !== "toggleBlock") return false;
          sync(updated);
          return true;
        },
      };
    };
  },
  addCommands() {
    return {
      setToggleBlock:
        () =>
        ({ chain, state }) =>
          chain()
            .wrapIn(this.name)
            .command(({ tr, dispatch }) => {
              if (!dispatch) return true;
              // Find the toggle we just wrapped around the selection and seed an
              // empty summary as its first child, then drop the caret into it so
              // the user types the title first.
              const { $from } = tr.selection;
              let depth = $from.depth;
              while (depth > 0 && $from.node(depth).type.name !== "toggleBlock") depth--;
              if (depth === 0) return true;
              const toggle = $from.node(depth);
              if (toggle.firstChild?.type.name === "toggleSummary") return true;
              const summary = state.schema.nodes.toggleSummary.createAndFill();
              if (!summary) return true;
              const insertAt = $from.before(depth) + 1;
              tr.insert(insertAt, summary);
              tr.setSelection(TextSelection.create(tr.doc, insertAt + 1));
              return true;
            })
            .run(),
    };
  },
});

// Curated text colors for the picker. Concrete hex (not CSS vars) so the value
// survives copy/paste and HTML export as a plain inline style.
const TEXT_COLORS: { label: string; value: string }[] = [
  { label: "Coral", value: "#FF8B81" },
  { label: "Teal", value: "#12B5A5" },
  { label: "Blue", value: "#3B7DD8" },
  { label: "Purple", value: "#8B5CF6" },
  { label: "Green", value: "#3F9B57" },
  { label: "Amber", value: "#E0A32E" },
  { label: "Red", value: "#DC4C4C" },
  { label: "Slate", value: "#5B6472" },
];

// Highlight (text background) swatches. Soft tints so dark body text stays
// readable on top; concrete hex so the value survives copy/paste + HTML export.
const HIGHLIGHT_COLORS: { label: string; value: string }[] = [
  { label: "Yellow", value: "#FEF3C7" },
  { label: "Green", value: "#D1FAE5" },
  { label: "Blue", value: "#DBEAFE" },
  { label: "Purple", value: "#EDE9FE" },
  { label: "Pink", value: "#FCE7F3" },
  { label: "Orange", value: "#FFEDD5" },
  { label: "Red", value: "#FEE2E2" },
  { label: "Gray", value: "#E5E7EB" },
];

const LINE_SPACINGS: { label: string; value: string | null }[] = [
  { label: "Default", value: null },
  { label: "Single", value: "1" },
  { label: "1.5", value: "1.5" },
  { label: "Double", value: "2" },
];

// Small toolbar dropdown: a trigger that toggles a popover panel, closing on
// outside click. Shared by the color + line-spacing controls.
function ToolbarPopover({
  title,
  trigger,
  children,
}: {
  title: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={title}
        aria-label={title}
        aria-haspopup="true"
        aria-expanded={open}
        onMouseDown={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
        className={`inline-flex items-center gap-0.5 rounded p-1.5 transition-colors ${
          open
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted"
        }`}
      >
        {trigger}
        <ChevronDown size={11} aria-hidden />
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 rounded-md border border-border bg-card p-2 shadow-brand-2">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function ColorControl({ editor }: { editor: Editor }) {
  const current = (editor.getAttributes("textStyle").color as string | undefined) ?? null;
  return (
    <ToolbarPopover
      title="Text color"
      trigger={<Baseline size={15} style={current ? { color: current } : undefined} />}
    >
      {(close) => (
        <div className="w-max">
          <div className="grid grid-cols-4 gap-1">
            {TEXT_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                title={c.label}
                aria-label={c.label}
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor.chain().focus().setColor(c.value).run();
                  close();
                }}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-black/10"
                style={{ backgroundColor: c.value }}
              >
                {current === c.value && <Check size={12} className="text-white" />}
              </button>
            ))}
          </div>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().unsetColor().run();
              close();
            }}
            className="mt-2 w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Default color
          </button>
        </div>
      )}
    </ToolbarPopover>
  );
}

function HighlightControl({ editor }: { editor: Editor }) {
  const current = (editor.getAttributes("highlight").color as string | undefined) ?? null;
  return (
    <ToolbarPopover
      title="Highlight"
      trigger={<Highlighter size={15} style={current ? { color: current } : undefined} />}
    >
      {(close) => (
        <div className="w-max">
          <div className="grid grid-cols-4 gap-1">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                title={c.label}
                aria-label={c.label}
                onMouseDown={(e) => {
                  e.preventDefault();
                  editor.chain().focus().setHighlight({ color: c.value }).run();
                  close();
                }}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-black/10"
                style={{ backgroundColor: c.value }}
              >
                {current === c.value && <Check size={12} className="text-black/70" />}
              </button>
            ))}
          </div>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().unsetHighlight().run();
              close();
            }}
            className="mt-2 w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            No highlight
          </button>
        </div>
      )}
    </ToolbarPopover>
  );
}

function LineSpacingControl({ editor }: { editor: Editor }) {
  const current =
    (editor.getAttributes("paragraph").lineHeight as string | undefined) ??
    (editor.getAttributes("heading").lineHeight as string | undefined) ??
    null;
  return (
    <ToolbarPopover title="Line spacing" trigger={<AlignJustify size={15} />}>
      {(close) => (
        <div className="min-w-[7rem]">
          {LINE_SPACINGS.map((s) => {
            const active = (s.value ?? null) === current;
            return (
              <button
                key={s.label}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (s.value) editor.chain().focus().setLineHeight(s.value).run();
                  else editor.chain().focus().unsetLineHeight().run();
                  close();
                }}
                className={`flex w-full items-center justify-between gap-3 rounded px-2 py-1 text-sm transition-colors ${
                  active ? "text-accent-coral" : "text-foreground hover:bg-muted"
                }`}
              >
                {s.label}
                {active && <Check size={13} aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </ToolbarPopover>
  );
}

type ToolbarAction = {
  label: string;
  icon: typeof Bold;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
};

const TOOLBAR_ACTIONS: ToolbarAction[] = [
  {
    label: "Bold",
    icon: Bold,
    isActive: (e) => e.isActive("bold"),
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    label: "Italic",
    icon: Italic,
    isActive: (e) => e.isActive("italic"),
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    label: "Underline",
    icon: UnderlineIcon,
    isActive: (e) => e.isActive("underline"),
    run: (e) => e.chain().focus().toggleUnderline().run(),
  },
  {
    label: "Strikethrough",
    icon: Strikethrough,
    isActive: (e) => e.isActive("strike"),
    run: (e) => e.chain().focus().toggleStrike().run(),
  },
  {
    label: "Inline code",
    icon: Code,
    isActive: (e) => e.isActive("code"),
    run: (e) => e.chain().focus().toggleCode().run(),
  },
  {
    label: "Heading 1",
    icon: Heading1,
    isActive: (e) => e.isActive("heading", { level: 1 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    label: "Heading 2",
    icon: Heading2,
    isActive: (e) => e.isActive("heading", { level: 2 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    label: "Heading 3",
    icon: Heading3,
    isActive: (e) => e.isActive("heading", { level: 3 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    label: "Bullet list",
    icon: List,
    isActive: (e) => e.isActive("bulletList"),
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    label: "Numbered list",
    icon: ListOrdered,
    isActive: (e) => e.isActive("orderedList"),
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    label: "Quote",
    icon: Quote,
    isActive: (e) => e.isActive("blockquote"),
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
];

function EditorToolbar({
  editor,
  onOpenHistory,
  showImageButton = false,
}: {
  editor: Editor;
  onOpenHistory: () => void;
  showImageButton?: boolean;
}) {
  // Tiptap doesn't trigger a React re-render on its own; re-render on every
  // transaction so the active-button highlighting (bold/heading/etc. state)
  // tracks the current selection.
  const [, setTick] = useState(0);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const rerender = () => setTick((t) => t + 1);
    editor.on("transaction", rerender);
    return () => {
      editor.off("transaction", rerender);
    };
  }, [editor]);

  async function onImagePicked(files: FileList | null) {
    for (const file of Array.from(files ?? [])) {
      try {
        const src = await uploadEditorImage(file);
        editor
          .chain()
          .focus()
          .setImage({ src, alt: file.name.replace(/\.[^.]+$/, "") })
          .run();
      } catch (err) {
        console.error("[editor] image upload failed", err);
      }
    }
    if (imageInputRef.current) imageInputRef.current.value = "";
  }

  return (
    <div className="flex items-center justify-between gap-1 border-b border-border px-1.5 py-1">
      <div className="flex flex-wrap items-center gap-0.5">
        {TOOLBAR_ACTIONS.map(({ label, icon: Icon, isActive, run }) => (
          <button
            key={label}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={isActive(editor)}
            onMouseDown={(e) => {
              // Preserve the current selection through the click.
              e.preventDefault();
              run(editor);
            }}
            className={`p-1.5 rounded transition-colors ${
              isActive(editor)
                ? "bg-accent-coral/15 text-accent-coral"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <Icon size={15} />
          </button>
        ))}
        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
        <ColorControl editor={editor} />
        <HighlightControl editor={editor} />
        <LineSpacingControl editor={editor} />
        <button
          type="button"
          title="Toggle list (collapsible section)"
          aria-label="Toggle list"
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().setToggleBlock().run();
          }}
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ListCollapse size={15} />
        </button>
        {showImageButton && (
          <>
            <button
              type="button"
              title="Image"
              aria-label="Image"
              onMouseDown={(e) => {
                e.preventDefault();
                imageInputRef.current?.click();
              }}
              className="p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <ImageIcon size={15} />
            </button>
            <input
              ref={imageInputRef}
              type="file"
              accept={IMAGE_UPLOAD_ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => void onImagePicked(e.target.files)}
            />
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onOpenHistory}
        title="Version history"
        aria-label="Version history"
        className="flex-shrink-0 p-1.5 rounded text-muted-foreground/70 hover:text-foreground/80 hover:bg-muted transition-colors"
      >
        <History size={15} />
      </button>
    </div>
  );
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
  enableMentions = false,
  enableImages = false,
  enableRichBlocks = false,
  chromeless = false,
  focusMentionUserId,
  onBeginEdit,
  onWordCountChange,
  onHeadingsChange,
  onReady,
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
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      LineSpacing,
      ToggleSummary,
      ToggleBlock,
      TabKeymap,
      ...(enableMentions ? [mentionEditorExtension(searchMentionableUsers)] : []),
      ...(enableImages ? imageEditorExtensions() : []),
      ...(enableRichBlocks ? [...richBlockExtensions(), slashCommandExtension()] : []),
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
        // Extra left padding when rich blocks are on, so the drag handle / "+"
        // sit in a gutter beside the text instead of overhanging the edge.
        class: enableRichBlocks ? `${EDITOR_CONTENT_CLASS} pl-10` : EDITOR_CONTENT_CLASS,
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

  // Deep-link from a mention notification: once the collab doc has synced,
  // scroll to the first mention node tagging this user and flash it. The doc
  // arrives asynchronously over the websocket, so poll briefly until the node
  // exists (or give up).
  useEffect(() => {
    if (!editor || !focusMentionUserId) return;
    let cancelled = false;
    let tries = 0;
    const attempt = () => {
      if (cancelled) return;
      let pos = -1;
      editor.state.doc.descendants((node, p) => {
        if (pos >= 0) return false;
        if (node.type.name === "mention" && node.attrs?.id === focusMentionUserId) {
          pos = p;
          return false;
        }
        return undefined;
      });
      if (pos >= 0) {
        editor.chain().setTextSelection(pos + 1).scrollIntoView().run();
        const dom = editor.view.nodeDOM(pos);
        if (dom instanceof HTMLElement) {
          dom.classList.add("mention-flash");
          setTimeout(() => dom.classList.remove("mention-flash"), 2600);
        }
        return;
      }
      if (tries++ < 24) setTimeout(attempt, 250); // ~6s of retries during sync
    };
    const t = setTimeout(attempt, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [editor, focusMentionUserId]);

  // Read/edit mode. When `disabled` flips true→false (the host switched the
  // doc into edit mode) we focus the editor, placing the caret where the user
  // clicked in read mode if we captured it (pendingClickRef). ProseMirror's
  // `editable` flag only gates *user* input, so setEditable + programmatic
  // focus/selection is safe from an effect.
  const pendingClickRef = useRef<{ x: number; y: number } | null>(null);
  const prevDisabledRef = useRef(disabled);
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
    const justEnabled = prevDisabledRef.current && !disabled;
    prevDisabledRef.current = disabled;
    if (!justEnabled) return;
    const click = pendingClickRef.current;
    pendingClickRef.current = null;
    // Run after the contenteditable flip lands so posAtCoords/focus resolve.
    requestAnimationFrame(() => {
      const at = click
        ? editor.view.posAtCoords({ left: click.x, top: click.y })
        : null;
      if (at) editor.chain().focus().setTextSelection(at.pos).run();
      else editor.commands.focus();
    });
  }, [editor, disabled]);

  // Auto-switch to edit mode on the first interaction while in read mode. Only
  // active when the host opted in via onBeginEdit (a viewer who could edit).
  // mousedown fires before any keystroke and records the click point so the
  // caret can land there once editing is enabled; we don't preventDefault so
  // the browser's native selection still tracks the click.
  const onBeginEditRef = useRef(onBeginEdit);
  onBeginEditRef.current = onBeginEdit;
  useEffect(() => {
    if (!editor || !disabled || !onBeginEdit) return;
    const dom = editor.view.dom;
    const onMouseDown = (e: MouseEvent) => {
      pendingClickRef.current = { x: e.clientX, y: e.clientY };
      onBeginEditRef.current?.();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      // A printable key or Enter while read-only would be swallowed during the
      // async editable flip, so arm edit mode and consume this one keystroke.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length === 1 || e.key === "Enter") {
        e.preventDefault();
        onBeginEditRef.current?.();
      }
    };
    dom.addEventListener("mousedown", onMouseDown);
    dom.addEventListener("keydown", onKeyDown);
    return () => {
      dom.removeEventListener("mousedown", onMouseDown);
      dom.removeEventListener("keydown", onKeyDown);
    };
  }, [editor, disabled, onBeginEdit]);

  // Live document outline + word count, recomputed (throttled) as the body
  // changes — including remote collab edits, which arrive as transactions that
  // fire "update". Both callbacks are optional so non-doc editors pay nothing.
  const onWordCountRef = useRef(onWordCountChange);
  const onHeadingsRef = useRef(onHeadingsChange);
  onWordCountRef.current = onWordCountChange;
  onHeadingsRef.current = onHeadingsChange;
  useEffect(() => {
    if (!editor || (!onWordCountChange && !onHeadingsChange)) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const compute = () => {
      onWordCountRef.current?.(
        editor.getText().trim() ? editor.getText().trim().split(/\s+/).length : 0,
      );
      if (onHeadingsRef.current) {
        const headings: TocHeading[] = [];
        editor.state.doc.descendants((node) => {
          if (node.type.name === "heading" && Number(node.attrs.level) <= 3) {
            headings.push({
              level: Number(node.attrs.level),
              text: node.textContent,
              ordinal: headings.length,
            });
          }
          return undefined;
        });
        onHeadingsRef.current(headings);
      }
    };
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        compute();
      }, 400);
    };
    compute();
    editor.on("update", schedule);
    return () => {
      if (timer) clearTimeout(timer);
      editor.off("update", schedule);
    };
  }, [editor, onWordCountChange, onHeadingsChange]);

  // Imperative API for the host (e.g. click a ToC entry → scroll to that
  // heading). Positions shift under live collab, so we re-resolve the ordinal-th
  // heading against the current doc rather than caching a raw position.
  const onReadyRefApi = useRef(onReady);
  onReadyRefApi.current = onReady;
  useEffect(() => {
    if (!editor) return;
    onReadyRefApi.current?.({
      scrollToHeading: (ordinal: number) => {
        let seen = -1;
        let targetPos = -1;
        editor.state.doc.descendants((node, pos) => {
          if (targetPos >= 0) return false;
          if (node.type.name === "heading" && Number(node.attrs.level) <= 3) {
            seen++;
            if (seen === ordinal) {
              targetPos = pos;
              return false;
            }
          }
          return undefined;
        });
        if (targetPos < 0) return;
        const dom = editor.view.nodeDOM(targetPos);
        if (dom instanceof HTMLElement) {
          dom.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      },
    });
  }, [editor]);

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
        const from = decodeAbsolute(entry.ydoc, entry.fragment, binding.mapping, anchor.from);
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
    const fromRel = encodeRelative(entry.ydoc, entry.fragment, binding.mapping, from);
    const toRel = encodeRelative(entry.ydoc, entry.fragment, binding.mapping, to);
    if (!fromRel || !toRel) return;
    setCommentBtn(null);
    onRequestComment?.({ from: fromRel, to: toRel });
  }

  // Clicking an existing inline-comment highlight opens a popover right next
  // to the text (see getThreadNode) instead of requiring a scroll down to the
  // comments rail. Positioned off the highlight span's own rect rather than
  // the selection, since a click doesn't necessarily select anything.
  const [threadPopover, setThreadPopover] = useState<{ id: string; top: number; left: number } | null>(null);
  const threadPopoverRef = useRef<HTMLDivElement | null>(null);

  function handleEditorContentClick(e: React.MouseEvent) {
    if (!inlineComments?.enabled || !inlineComments.getThreadNode) return;
    const hit = (e.target as HTMLElement).closest<HTMLElement>(".inline-comment-highlight");
    if (!hit) {
      setThreadPopover(null);
      return;
    }
    const id = hit.getAttribute("data-comment-id");
    const container = containerRef.current;
    if (!id || !container) return;
    const rect = hit.getBoundingClientRect();
    const box = container.getBoundingClientRect();
    setThreadPopover({ id, top: rect.bottom - box.top + 6, left: rect.left - box.left });
  }

  useEffect(() => {
    if (!threadPopover) return;
    function onOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (threadPopoverRef.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.(".inline-comment-highlight")) return;
      setThreadPopover(null);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [threadPopover]);

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

  // The block the drag handle is currently anchored to — target for the "+"
  // insert-below button. onNodeChange MUST be stable: DragHandle re-runs its
  // plugin registration when its props change, and re-registering a plugin
  // reconfigures the editor, which resets the "/" suggestion plugin's state
  // (making the slash menu flash open then close on the next re-render).
  const hoveredPosRef = useRef<number | null>(null);
  const onDragNodeChange = useCallback(({ pos }: { pos: number }) => {
    hoveredPosRef.current = pos;
  }, []);
  const insertBlockBelow = useCallback(() => {
    if (!editor) return;
    const pos = hoveredPosRef.current;
    if (pos == null) return;
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return;
    const end = pos + node.nodeSize;
    editor
      .chain()
      .insertContentAt(end, { type: "paragraph" })
      .setTextSelection(end + 1)
      .focus()
      .run();
  }, [editor]);

  return (
    <EditorShell
      ref={containerRef}
      relative
      disabled={disabled}
      muted={disabled && !onBeginEdit}
      chromeless={chromeless}
      className={className}
    >
      {editor && !disabled ? (
        <EditorToolbar
          editor={editor}
          onOpenHistory={() => setHistoryOpen(true)}
          showImageButton={enableImages}
        />
      ) : (
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          title="Version history"
          aria-label="Version history"
          className="absolute top-1.5 right-1.5 z-10 p-1 rounded text-muted-foreground/70 hover:text-foreground/80 hover:bg-muted transition-colors"
        >
          <History size={14} />
        </button>
      )}
      {historyOpen && (
        <VersionHistoryPanel
          documentName={documentName}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {/* Standalone comment button — only when there's no bubble toolbar to
          host the comment action (rich-blocks folds commenting into the bubble). */}
      {inlineComments?.enabled && commentBtn && !(enableRichBlocks && !disabled) && (
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
      {editor && !disabled && enableRichBlocks && (
        <>
          <BubbleMenu editor={editor} className="z-30">
            <BubbleToolbar
              editor={editor}
              onComment={inlineComments?.enabled ? requestCommentOnSelection : undefined}
            />
          </BubbleMenu>
          <DragHandle editor={editor} onNodeChange={onDragNodeChange}>
            <div className="flex items-center gap-0.5 pr-1">
              <button
                type="button"
                title="Add block below"
                onMouseDown={(e) => {
                  // Don't let the drag plugin treat this click as a drag start.
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={insertBlockBelow}
                className="flex h-6 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Plus size={15} />
              </button>
              <span
                title="Drag to move"
                className="flex h-6 w-5 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <GripVertical size={15} />
              </span>
            </div>
          </DragHandle>
        </>
      )}
      <div onClick={handleEditorContentClick}>
        <EditorContent editor={editor} />
      </div>
      {inlineComments?.enabled && threadPopover && inlineComments.getThreadNode && (
        <div
          ref={threadPopoverRef}
          style={{ top: threadPopover.top, left: threadPopover.left }}
          className="absolute z-30 w-72 rounded-lg border border-border bg-card shadow-lg"
        >
          {inlineComments.getThreadNode(threadPopover.id, () => setThreadPopover(null))}
        </div>
      )}
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
    </EditorShell>
  );
}
