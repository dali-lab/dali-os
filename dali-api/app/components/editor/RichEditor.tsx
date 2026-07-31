// The one non-collab editor core. Read and write are the same component in
// different modes (Notion/Google-Docs model — no separate "viewer"): `bare`
// renders the read-only, chromeless view (what RichTextViewer wraps), otherwise
// it's the editable, card-chrome editor (what RichTextEditor wraps). Both build
// their extensions from the SAME resolved features via buildExtensions, so a
// node enabled for editing is impossible to forget on read.

import { useEditor, EditorContent } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import {
  EDITOR_CONTENT_CLASS,
  EDITOR_VIEWER_CONTENT_CLASS,
  EditorShell,
  isEmptyDoc,
  isProseMirrorDoc,
} from "./shared";
import { buildExtensions, type EditorFeatures } from "./presets";
import { EditorToolbar, type ToolbarDensity } from "./toolbar";

export interface RichEditorProps {
  content: unknown;
  features: EditorFeatures;
  className?: string;
  // Read-only chromeless render (the viewer). When false, the editable card.
  bare?: boolean;
  // Editable-mode props (ignored when bare):
  onChange?: (json: unknown) => void;
  placeholder?: string;
  disabled?: boolean;
  density?: ToolbarDensity;
}

export function RichEditor({
  content,
  features,
  className,
  bare = false,
  onChange,
  placeholder,
  disabled = false,
  density = "compact",
}: RichEditorProps) {
  const editable = !bare && !disabled;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [imageError, setImageError] = useState<string | null>(null);
  const imageErrorRef = useRef(setImageError);
  imageErrorRef.current = setImageError;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: buildExtensions(features, {
      side: bare ? "viewer" : "editor",
      placeholder,
      onImageError: (m) => imageErrorRef.current(m),
    }),
    content: bare
      ? isEmptyDoc(content)
        ? ""
        : (content as object)
      : isProseMirrorDoc(content)
        ? (content as object)
        : "",
    editable,
    editorProps: {
      attributes: {
        class: bare ? EDITOR_VIEWER_CONTENT_CLASS : EDITOR_CONTENT_CLASS,
      },
    },
    onUpdate: bare
      ? undefined
      : ({ editor }) => onChangeRef.current?.(editor.getJSON()),
  });

  // Editable card: keep editability in sync with `disabled`.
  useEffect(() => {
    if (!bare && editor) editor.setEditable(editable);
  }, [bare, editor, editable]);

  // Viewer: content is controlled — re-render when it changes.
  useEffect(() => {
    if (!bare || !editor) return;
    editor.commands.setContent(isEmptyDoc(content) ? "" : (content as object));
  }, [bare, editor, content]);

  if (bare) {
    if (isEmptyDoc(content)) return null;
    return (
      <div className={className}>
        <EditorContent editor={editor} />
      </div>
    );
  }

  return (
    <EditorShell disabled={disabled} className={className}>
      {editor && editable ? (
        <EditorToolbar editor={editor} features={features} density={density} />
      ) : null}
      <EditorContent editor={editor} />
      {imageError && (
        <p className="px-3 pb-2 text-xs text-destructive">
          Couldn't add the image — {imageError}
        </p>
      )}
    </EditorShell>
  );
}
