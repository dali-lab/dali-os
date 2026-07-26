import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  Highlighter,
  Link2,
  MessageSquarePlus,
} from "lucide-react";

// Compact formatting bar shown floating over a text selection (rendered inside
// <BubbleMenu>). Complements the fixed toolbar for quick, in-context styling.
// When onComment is provided, a comment action is folded in so the standalone
// comment button isn't needed.
const DEFAULT_HIGHLIGHT = "#FEF3C7";

export function BubbleToolbar({
  editor,
  onComment,
}: {
  editor: Editor;
  onComment?: () => void;
}) {
  const btn = (active: boolean) =>
    `flex h-7 w-7 items-center justify-center rounded transition-colors ${
      active
        ? "bg-accent-coral/15 text-accent-coral"
        : "text-muted-foreground hover:bg-muted hover:text-foreground"
    }`;

  const toggleLink = () => {
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const prev = (editor.getAttributes("link").href as string | undefined) ?? "";
    const url = window.prompt("Link URL", prev);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().setLink({ href: url }).run();
  };

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card p-1 shadow-brand-2">
      <button
        type="button"
        title="Bold"
        onMouseDown={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleBold().run();
        }}
        className={btn(editor.isActive("bold"))}
      >
        <Bold size={15} />
      </button>
      <button
        type="button"
        title="Italic"
        onMouseDown={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleItalic().run();
        }}
        className={btn(editor.isActive("italic"))}
      >
        <Italic size={15} />
      </button>
      <button
        type="button"
        title="Underline"
        onMouseDown={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleUnderline().run();
        }}
        className={btn(editor.isActive("underline"))}
      >
        <UnderlineIcon size={15} />
      </button>
      <button
        type="button"
        title="Strikethrough"
        onMouseDown={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleStrike().run();
        }}
        className={btn(editor.isActive("strike"))}
      >
        <Strikethrough size={15} />
      </button>
      <button
        type="button"
        title="Inline code"
        onMouseDown={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleCode().run();
        }}
        className={btn(editor.isActive("code"))}
      >
        <Code size={15} />
      </button>
      <button
        type="button"
        title="Highlight"
        onMouseDown={(e) => {
          e.preventDefault();
          if (editor.isActive("highlight")) editor.chain().focus().unsetHighlight().run();
          else editor.chain().focus().setHighlight({ color: DEFAULT_HIGHLIGHT }).run();
        }}
        className={btn(editor.isActive("highlight"))}
      >
        <Highlighter size={15} />
      </button>
      <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
      <button
        type="button"
        title="Link"
        onMouseDown={(e) => {
          e.preventDefault();
          toggleLink();
        }}
        className={btn(editor.isActive("link"))}
      >
        <Link2 size={15} />
      </button>
      {onComment && (
        <button
          type="button"
          title="Comment"
          onMouseDown={(e) => {
            e.preventDefault();
            onComment();
          }}
          className={btn(false)}
        >
          <MessageSquarePlus size={15} />
        </button>
      )}
    </div>
  );
}
