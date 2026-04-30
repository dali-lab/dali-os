import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import { useEffect, useRef, useState } from "react";

interface RichTextEditorProps {
  value: unknown;
  onChange: (json: unknown) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

const LINK_HTML_ATTRIBUTES = {
  target: "_blank",
  rel: "noopener noreferrer nofollow",
  class: "text-blue-600 underline hover:text-blue-800",
};

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
}: RichTextEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        protocols: LINK_PROTOCOLS,
        HTMLAttributes: LINK_HTML_ATTRIBUTES,
      }),
    ],
    content: isProseMirrorDoc(value) ? (value as object) : "",
    editable: !disabled,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none focus:outline-none min-h-[6rem] px-3 py-2",
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
    <div
      className={`rounded-lg border bg-card ${
        disabled
          ? "border-border bg-muted/50 opacity-75"
          : "border-gray-300 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent"
      } ${className ?? ""}`}
    >
      {editor && !disabled ? <Toolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
}

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

  const setLink = () => {
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
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: trimmed })
      .run();
  };

  const unsetLink = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
  };

  // version is read so React picks up active-state changes from editor events
  void version;

  if (!hasSelection && !isLinkActive) return null;

  return (
    <div className="flex items-center gap-1 border-b border-gray-200 px-2 py-1">
      <button
        type="button"
        onClick={setLink}
        className={`rounded px-2 py-1 text-xs font-medium ${
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
          className="rounded px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
          aria-label="Remove link"
        >
          Remove link
        </button>
      )}
    </div>
  );
}

function isProseMirrorDoc(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const maybe = value as { type?: unknown; content?: unknown };
  return maybe.type === "doc";
}
