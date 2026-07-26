// Rich block content for the document editor (opt-in via enableRichBlocks):
// tables, task lists, and a Notion-style callout. All additive to the collab
// ProseMirror schema — like mentions/images, every client on a room must run
// with them enabled, which holds because they ship in a single deploy and are
// only turned on for the /documents surface.

import { Node as TiptapNode, mergeAttributes } from "@tiptap/core";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (attrs?: { emoji?: string }) => ReturnType;
    };
  }
}

// A colored container with an emoji marker in the gutter and freeform block
// content. The emoji is a non-editable decoration in the nodeView; the body is
// normal editable block content.
export const Callout = TiptapNode.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      emoji: {
        default: "💡",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-emoji") || "💡",
        renderHTML: (attrs) => ({ "data-emoji": attrs.emoji }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-type='callout']" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "callout" }), 0];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div");
      dom.className = "callout";
      const icon = document.createElement("span");
      icon.className = "callout__icon";
      icon.contentEditable = "false";
      icon.textContent = (node.attrs.emoji as string) || "💡";
      const content = document.createElement("div");
      content.className = "callout__content";
      dom.appendChild(icon);
      dom.appendChild(content);
      return {
        dom,
        contentDOM: content,
        update: (updated) => {
          if (updated.type.name !== "callout") return false;
          icon.textContent = (updated.attrs.emoji as string) || "💡";
          return true;
        },
      };
    };
  },
  addCommands() {
    return {
      setCallout:
        (attrs) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attrs),
    };
  },
});

export function richBlockExtensions() {
  return [
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    Callout,
  ];
}
