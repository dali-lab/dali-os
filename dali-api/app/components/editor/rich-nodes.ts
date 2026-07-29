// Schema-defining nodes/marks shared by the collaborative editor and the
// read-only viewer. They MUST live in one place: if the viewer's schema is
// missing a node the editor can produce (a toggle block, a line-height attr, a
// table, an image), Tiptap silently drops that content when rendering. Keeping
// the definitions here lets `readonlyRichExtensions()` render everything the
// full editor authors, with no WebSocket/collab dependency.

import { Extension, Node as TiptapNode, mergeAttributes } from "@tiptap/core";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Fragment } from "@tiptap/pm/model";
import Image from "@tiptap/extension-image";
import { TextStyle, Color } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import { richBlockExtensions } from "./blocks";

const LINE_SPACING_TYPES = ["paragraph", "heading"];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    lineSpacing: {
      setLineHeight: (lineHeight: string) => ReturnType;
      unsetLineHeight: () => ReturnType;
    };
  }
}

export const LineSpacing = Extension.create({
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
export const ToggleSummary = TiptapNode.create({
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

export const ToggleBlock = TiptapNode.create({
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
      // Single-transaction wrap: replace the selected block(s) with a toggle
      // whose first child is an empty summary followed by the original content,
      // then drop the caret into the summary.
      //
      // Read from `tr` (its selection + doc), NOT `state`: when this runs inside
      // a chain — e.g. the slash menu / "+" do `deleteRange(range).setToggleBlock()`
      // to remove the "/" — `state` is the ORIGINAL editor state while `tr`
      // already has the earlier steps applied. Using `state` left the caret off
      // by the deleted "/", so the title came up blank and uneditable.
      setToggleBlock:
        () =>
        ({ state, tr, dispatch }) => {
          const { schema } = state;
          const { $from, $to } = tr.selection;
          const range = $from.blockRange($to);
          if (!range) return false;
          const summary = schema.nodes.toggleSummary.createAndFill();
          if (!summary) return false;
          const body = tr.doc.slice(range.start, range.end).content;
          const toggle = schema.nodes.toggleBlock.create(
            { open: true },
            Fragment.from(summary).append(body),
          );
          if (dispatch) {
            tr.replaceRangeWith(range.start, range.end, toggle);
            // The toggle is inserted at range.start; the summary's content is two
            // tokens in (toggle open + summary open). Positions are in tr's space,
            // so no extra mapping.
            tr.setSelection(TextSelection.create(tr.doc, range.start + 2));
            tr.scrollIntoView();
          }
          return true;
        },
    };
  },
});

/**
 * The static (non-collab, no-upload) rich content extensions for the read-only
 * viewer: images, tables/task-lists/callouts, text color, highlight, line
 * spacing, and toggle blocks. Mirrors the full editor's schema so nothing the
 * editor produces is dropped on render.
 */
export function readonlyRichExtensions() {
  return [
    Image.configure({ allowBase64: false }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    LineSpacing,
    ToggleSummary,
    ToggleBlock,
    ...richBlockExtensions(),
  ];
}
