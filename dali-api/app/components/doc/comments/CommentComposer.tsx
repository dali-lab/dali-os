// The new-thread composer: the card that floats under a selection when a
// comment is started from the formatting toolbar.
// Replaces BlockNote's stock FloatingComposer, which drew a bare editor flush
// against a shadcn card with a toolbar-style Save button, with the dali.os
// dress: a raised surface, the editor in a well, and the app's own buttons.

import type { BlockNoteEditor } from "@blocknote/core";
import { CommentsExtension } from "@blocknote/core/comments";
import {
  useBlockNoteEditor,
  useComponentsContext,
  useEditorState,
  useExtension,
} from "@blocknote/react";
import { TextSelection } from "@tiptap/pm/state";
import { useState, type KeyboardEvent } from "react";
import { Button } from "~/components/ui/Button";
import { OS_SURFACE_CLASS } from "~/components/ui/floating/styles";
import { cn } from "~/lib/cn";

export function CommentComposer({
  newCommentEditor,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  newCommentEditor: BlockNoteEditor<any, any, any>;
}) {
  const editor = useBlockNoteEditor();
  const comments = useExtension(CommentsExtension);
  const Components = useComponentsContext()!;
  const isEmpty = useEditorState({
    editor: newCommentEditor,
    selector: ({ editor }) => editor.isEmpty,
  });
  const [saving, setSaving] = useState(false);

  const cancel = () => {
    comments.stopPendingComment();
    editor.focus();
  };

  const save = async () => {
    if (isEmpty || saving) return;
    setSaving(true);
    try {
      await comments.createThread({ initialComment: { body: newCommentEditor.document } });
      comments.stopPendingComment();
      // Collapse the selection to its end, like the stock composer, so the
      // new mark isn't left sitting under a live selection.
      editor.transact((tr) => {
        tr.setSelection(TextSelection.create(tr.doc, tr.selection.to));
      });
      editor.focus();
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void save();
    }
  };

  return (
    <div
      className={cn(OS_SURFACE_CLASS, "dali-comment-composer flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-3 p-3")}
      onKeyDown={onKeyDown}
    >
      <div className="rounded-[10px] bg-os-well px-3 py-2 text-sm">
        <Components.Comments.Editor
          autoFocus
          editable
          className="bn-comment-editor"
          editor={newCommentEditor}
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={cancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={isEmpty || saving} onClick={() => void save()}>
          Comment
        </Button>
      </div>
    </div>
  );
}
