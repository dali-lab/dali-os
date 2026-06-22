import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useRef, useState } from "react";
import {
  EDITOR_CONTENT_CLASS,
  EditorShell,
  isProseMirrorDoc,
  linkExtension,
} from "./editor/shared";

interface RichTextEditorProps {
  value: unknown;
  onChange: (json: unknown) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
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
}: RichTextEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
      linkExtension({ interactive: false }),
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
      {editor && !disabled ? <Toolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
    </EditorShell>
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
