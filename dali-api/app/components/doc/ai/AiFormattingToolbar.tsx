// AiFormattingToolbar — replaces the plain <FormattingToolbar /> in DocEditorImpl.
//
// Renders all default BlockNote toolbar children (via getFormattingToolbarItems)
// PLUS, when AI is enabled and the editor is editable, a single "✦" sparkle
// button that opens the AI bar with the current text selection.
//
// Selection block ids are captured AT CLICK TIME before opening the session,
// because the selection is cleared as soon as focus moves to the AiBar input.

import React from "react";
import { AiSparkleIcon } from "./AiSparkleIcon";
import {
  FormattingToolbar,
  useBlockNoteEditor,
  useComponentsContext,
  AddCommentButton,
  AddTiptapCommentButton,
  BasicTextStyleButton,
  BlockTypeSelect,
  ColorStyleButton,
  CreateLinkButton,
  FileCaptionButton,
  FileDeleteButton,
  FileDownloadButton,
  FilePreviewButton,
  FileRenameButton,
  FileReplaceButton,
  NestBlockButton,
  TableCellMergeButton,
  TextAlignButton,
  UnnestBlockButton,
} from "@blocknote/react";
import { useToast } from "~/components/ui/toast";
import type { DocEditorInstance } from "../schema/build";
import type { AiBarConfig } from "./AiBar";

// ── Prop types ────────────────────────────────────────────────────────────────

interface AiFormattingToolbarProps {
  aiEnabled?: boolean;
  editable?: boolean;
  openSession?: (config: AiBarConfig) => void;
}

// ── AI sparkle button ─────────────────────────────────────────────────────────

function AiToolbarButton({
  editor,
  openSession,
}: {
  editor: DocEditorInstance;
  openSession: (config: AiBarConfig) => void;
}) {
  const Components = useComponentsContext()!;
  const toast = useToast();

  function handleClick() {
    const sel = editor.getSelection();
    const selectionBlockIds = sel?.blocks?.length ? sel.blocks.map((b) => b.id) : null;
    if (!selectionBlockIds) {
      toast.error("No text selected.");
      return;
    }
    openSession({
      origin: "toolbar",
      cursorBlockId: null,
      selectionBlockIds,
    });
  }

  return (
    <Components.FormattingToolbar.Button
      mainTooltip="Edit with AI"
      label="Edit with AI"
      icon={<AiSparkleIcon size={14} />}
      onClick={handleClick}
    />
  );
}

// ── Main toolbar component ────────────────────────────────────────────────────

/**
 * Custom FormattingToolbar that reproduces all BlockNote default toolbar items
 * and appends a single AI sparkle button when aiEnabled=true and editor is editable.
 *
 * Default toolbar items (from getFormattingToolbarItems / FormattingToolbar.tsx):
 *   BlockTypeSelect, TableCellMergeButton, FileCaptionButton, FileReplaceButton,
 *   FileRenameButton, FileDeleteButton, FileDownloadButton, FilePreviewButton,
 *   BasicTextStyleButton×4 (bold/italic/underline/strike),
 *   TextAlignButton×3 (left/center/right), ColorStyleButton,
 *   NestBlockButton, UnnestBlockButton, CreateLinkButton,
 *   AddCommentButton, AddTiptapCommentButton.
 *
 * Each component internally gates its own visibility (e.g. FileCaptionButton
 * only shows for file blocks), so rendering all is correct per BlockNote docs.
 */
export function AiFormattingToolbar(props: AiFormattingToolbarProps) {
  const editor = useBlockNoteEditor() as DocEditorInstance;
  const showAi = props.aiEnabled && (props.editable ?? true) && props.openSession;

  return (
    <FormattingToolbar>
      <BlockTypeSelect key="blockTypeSelect" />
      <TableCellMergeButton key="tableCellMergeButton" />
      <FileCaptionButton key="fileCaptionButton" />
      <FileReplaceButton key="replaceFileButton" />
      <FileRenameButton key="fileRenameButton" />
      <FileDeleteButton key="fileDeleteButton" />
      <FileDownloadButton key="fileDownloadButton" />
      <FilePreviewButton key="filePreviewButton" />
      <BasicTextStyleButton basicTextStyle="bold" key="boldStyleButton" />
      <BasicTextStyleButton basicTextStyle="italic" key="italicStyleButton" />
      <BasicTextStyleButton basicTextStyle="underline" key="underlineStyleButton" />
      <BasicTextStyleButton basicTextStyle="strike" key="strikeStyleButton" />
      <TextAlignButton textAlignment="left" key="textAlignLeftButton" />
      <TextAlignButton textAlignment="center" key="textAlignCenterButton" />
      <TextAlignButton textAlignment="right" key="textAlignRightButton" />
      <ColorStyleButton key="colorStyleButton" />
      <NestBlockButton key="nestBlockButton" />
      <UnnestBlockButton key="unnestBlockButton" />
      <CreateLinkButton key="createLinkButton" />
      <AddCommentButton key="addCommentButton" />
      <AddTiptapCommentButton key="addTiptapCommentButton" />
      {showAi && (
        <AiToolbarButton
          key="aiButton"
          editor={editor}
          openSession={props.openSession!}
        />
      )}
    </FormattingToolbar>
  );
}

// Factory that captures aiEnabled/editable/openSession in a stable component
// identity so FormattingToolbarController doesn't see a new component ref each
// render (which would cause the toolbar to remount on every editor state change).
//
// Usage: buildAiFormattingToolbar(aiEnabled, editable, openSession) → component,
// memoized by the caller with useMemo.
export function buildAiFormattingToolbar(
  aiEnabled: boolean,
  editable: boolean,
  openSession: (config: AiBarConfig) => void,
): () => React.JSX.Element {
  return function AiFormattingToolbarInstance() {
    return (
      <AiFormattingToolbar
        aiEnabled={aiEnabled}
        editable={editable}
        openSession={openSession}
      />
    );
  };
}
