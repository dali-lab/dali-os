import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useRef } from "react";

interface RichTextEditorProps {
  value: unknown;
  onChange: (json: unknown) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
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
    extensions: [StarterKit, Placeholder.configure({ placeholder })],
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
      <EditorContent editor={editor} />
    </div>
  );
}

function isProseMirrorDoc(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const maybe = value as { type?: unknown; content?: unknown };
  return maybe.type === "doc";
}
