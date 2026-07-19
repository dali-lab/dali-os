import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useRef, useState } from "react";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link2,
  Link2Off,
  Undo2,
  Redo2,
} from "lucide-react";
import {
  EDITOR_CONTENT_CLASS,
  EditorShell,
  isProseMirrorDoc,
  linkExtension,
} from "./editor/shared";
import { mentionEditorExtension, searchMentionableUsers } from "./editor/mention";

interface RichTextEditorProps {
  value: unknown;
  onChange: (json: unknown) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  // Opt in to @-mention typeahead (page-doc guides). Off by default so other
  // editor surfaces (mentorship notes, form builder) don't fire member lookups.
  enableMentions?: boolean;
  // Show the persistent Google-Docs-style formatting toolbar (bold/italic/
  // headings/lists/quote/link/undo). Off by default — other surfaces keep the
  // minimal selection-only link toolbar.
  richToolbar?: boolean;
}

const LINK_PROTOCOLS = ["http", "https", "mailto"];

export function isSafeLinkUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    const protocol = url.protocol.replace(/:$/, "").toLowerCase();
    return LINK_PROTOCOLS.includes(protocol);
  } catch {
    return false;
  }
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = "Write a description…",
  disabled = false,
  className,
  enableMentions = false,
  richToolbar = false,
}: RichTextEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
      linkExtension({ interactive: false }),
      ...(enableMentions ? [mentionEditorExtension(searchMentionableUsers)] : []),
    ],
    content: isProseMirrorDoc(value) ? (value as object) : "",
    editable: !disabled,
    editorProps: {
      attributes: {
        class: EDITOR_CONTENT_CLASS,
      },
    },
    onUpdate: ({ editor }) => {
      onChangeRef.current(editor.getJSON());
    },
  });

  useEffect(() => {
    if (editor) editor.setEditable(!disabled);
  }, [editor, disabled]);

  return (
    <EditorShell disabled={disabled} className={className}>
      {editor && !disabled ? (
        richToolbar ? (
          <FormattingToolbar editor={editor} />
        ) : (
          <Toolbar editor={editor} />
        )
      ) : null}
      <EditorContent editor={editor} />
    </EditorShell>
  );
}

// Shared link prompt used by both toolbars.
function promptForLink(editor: Editor) {
  const previous = (editor.getAttributes("link").href as string | undefined) ?? "";
  const input = window.prompt("Enter URL (https:// or mailto:)", previous);
  if (input === null) return;
  const trimmed = input.trim();
  if (!trimmed) {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    return;
  }
  if (!isSafeLinkUrl(trimmed)) {
    window.alert("Only http(s):// and mailto: links are allowed.");
    return;
  }
  editor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run();
}

// ─── Full formatting toolbar (Google-Docs-style, always visible) ────────────

type ToolbarAction = {
  label: string;
  icon: typeof Bold;
  isActive?: (e: Editor) => boolean;
  isDisabled?: (e: Editor) => boolean;
  run: (e: Editor) => void;
};

const FORMAT_GROUPS: ToolbarAction[][] = [
  [
    {
      label: "Undo",
      icon: Undo2,
      isDisabled: (e) => !e.can().undo(),
      run: (e) => e.chain().focus().undo().run(),
    },
    {
      label: "Redo",
      icon: Redo2,
      isDisabled: (e) => !e.can().redo(),
      run: (e) => e.chain().focus().redo().run(),
    },
  ],
  [
    { label: "Bold", icon: Bold, isActive: (e) => e.isActive("bold"), run: (e) => e.chain().focus().toggleBold().run() },
    { label: "Italic", icon: Italic, isActive: (e) => e.isActive("italic"), run: (e) => e.chain().focus().toggleItalic().run() },
    { label: "Strikethrough", icon: Strikethrough, isActive: (e) => e.isActive("strike"), run: (e) => e.chain().focus().toggleStrike().run() },
    { label: "Inline code", icon: Code, isActive: (e) => e.isActive("code"), run: (e) => e.chain().focus().toggleCode().run() },
  ],
  [
    { label: "Heading 1", icon: Heading1, isActive: (e) => e.isActive("heading", { level: 1 }), run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
    { label: "Heading 2", icon: Heading2, isActive: (e) => e.isActive("heading", { level: 2 }), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "Heading 3", icon: Heading3, isActive: (e) => e.isActive("heading", { level: 3 }), run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  ],
  [
    { label: "Bullet list", icon: List, isActive: (e) => e.isActive("bulletList"), run: (e) => e.chain().focus().toggleBulletList().run() },
    { label: "Numbered list", icon: ListOrdered, isActive: (e) => e.isActive("orderedList"), run: (e) => e.chain().focus().toggleOrderedList().run() },
    { label: "Quote", icon: Quote, isActive: (e) => e.isActive("blockquote"), run: (e) => e.chain().focus().toggleBlockquote().run() },
  ],
];

function FormattingToolbar({ editor }: { editor: Editor }) {
  // Tiptap doesn't re-render React on its own; tick on every transaction so
  // active/disabled states track the selection.
  const [, setTick] = useState(0);
  useEffect(() => {
    const rerender = () => setTick((t) => t + 1);
    editor.on("transaction", rerender);
    return () => {
      editor.off("transaction", rerender);
    };
  }, [editor]);

  const linkActive = editor.isActive("link");

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-200 px-1.5 py-1">
      {FORMAT_GROUPS.map((group, gi) => (
        <div key={gi} className="flex items-center gap-0.5">
          {gi > 0 && <span className="mx-1 h-5 w-px bg-border" aria-hidden />}
          {group.map(({ label, icon: Icon, isActive, isDisabled, run }) => {
            const active = isActive?.(editor) ?? false;
            const dis = isDisabled?.(editor) ?? false;
            return (
              <button
                key={label}
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={active}
                disabled={dis}
                onMouseDown={(e) => {
                  e.preventDefault();
                  run(editor);
                }}
                className={`rounded p-1.5 transition-colors disabled:opacity-40 disabled:pointer-events-none ${
                  active
                    ? "bg-accent-coral/15 text-accent-coral"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <Icon size={15} />
              </button>
            );
          })}
        </div>
      ))}
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <button
        type="button"
        title={linkActive ? "Edit link" : "Add link"}
        aria-label={linkActive ? "Edit link" : "Add link"}
        aria-pressed={linkActive}
        onMouseDown={(e) => {
          e.preventDefault();
          promptForLink(editor);
        }}
        className={`rounded p-1.5 transition-colors ${
          linkActive
            ? "bg-accent-coral/15 text-accent-coral"
            : "text-muted-foreground hover:text-foreground hover:bg-muted"
        }`}
      >
        <Link2 size={15} />
      </button>
      {linkActive && (
        <button
          type="button"
          title="Remove link"
          aria-label="Remove link"
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
          }}
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Link2Off size={15} />
        </button>
      )}
    </div>
  );
}

// ─── Minimal selection-only link toolbar (default for other surfaces) ───────

function Toolbar({ editor }: { editor: Editor }) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const rerender = () => setVersion(v => v + 1);
    editor.on("selectionUpdate", rerender);
    editor.on("transaction", rerender);
    return () => {
      editor.off("selectionUpdate", rerender);
      editor.off("transaction", rerender);
    };
  }, [editor]);

  const { from, to } = editor.state.selection;
  const hasSelection = from !== to;
  const isLinkActive = editor.isActive("link");

  const setLink = () => promptForLink(editor);

  const unsetLink = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
  };

  // version is read so React picks up active-state changes from editor events
  void version;

  if (!hasSelection && !isLinkActive) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 gap-y-1 border-b border-gray-200 px-2 py-1">
      <button
        type="button"
        onClick={setLink}
        className={`rounded p-2 text-sm font-medium sm:px-2 sm:py-1 sm:text-xs ${
          isLinkActive
            ? "bg-blue-100 text-blue-800"
            : "text-gray-700 hover:bg-gray-100"
        }`}
        aria-label={isLinkActive ? "Edit link" : "Add link"}
      >
        {isLinkActive ? "Edit link" : "Link"}
      </button>
      {isLinkActive && (
        <button
          type="button"
          onClick={unsetLink}
          className="rounded p-2 text-sm font-medium text-gray-700 hover:bg-gray-100 sm:px-2 sm:py-1 sm:text-xs"
          aria-label="Remove link"
        >
          Remove link
        </button>
      )}
    </div>
  );
}
