// AiFormattingToolbar — replaces the plain <FormattingToolbar /> in DocEditorImpl.
//
// Renders all default BlockNote toolbar children (via getFormattingToolbarItems)
// PLUS, when AI is enabled and the editor is editable, an "AI ✦" dropdown button
// that operates on the CURRENT TEXT SELECTION (which survives in the floating
// toolbar — no "/" was typed).
//
// Selection block ids are captured AT CLICK TIME before opening the session,
// because the selection is cleared as soon as focus moves to the AiPanel input.
//
// The AI dropdown is built with useComponentsContext()!.Generic.Menu.* so it
// inherits the BlockNote/shadcn styling automatically.

import React from "react";
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
import type { AiSessionConfig } from "./apply";

// ── Prop types ────────────────────────────────────────────────────────────────

interface AiFormattingToolbarProps {
  aiEnabled?: boolean;
  editable?: boolean;
  openSession?: (config: AiSessionConfig) => void;
}

// ── AI dropdown menu ──────────────────────────────────────────────────────────

function AiToolbarMenu({
  editor,
  openSession,
}: {
  editor: DocEditorInstance;
  openSession: (config: AiSessionConfig) => void;
}) {
  const Components = useComponentsContext()!;
  const toast = useToast();

  /**
   * Capture the current selection block ids synchronously at click time.
   * The selection is cleared when the panel's input steals focus, so we must
   * capture it before opening the session.
   */
  function captureSelection(): string[] | null {
    const sel = editor.getSelection();
    if (!sel?.blocks?.length) return null;
    return sel.blocks.map((b) => b.id);
  }

  function toolbarSession(action: AiSessionConfig["action"]) {
    const selectionBlockIds = captureSelection();
    if (!selectionBlockIds) {
      toast.error("No text selected.");
      return;
    }
    openSession({
      action,
      origin: "toolbar",
      cursorBlockId: null,
      selectionBlockIds,
      cursorBlockWasEmpty: false,
    });
  }

  const handleImprove = () => toolbarSession("improve");
  const handleFix = () => toolbarSession("fix");
  const handleSummarize = () => toolbarSession("summarize");
  const handleAskAi = () => toolbarSession("prompt");

  const Menu = Components.Generic.Menu;

  return (
    <Menu.Root>
      <Menu.Trigger>
        <Components.FormattingToolbar.Button
          mainTooltip="AI actions"
          label="AI ✦"
        />
      </Menu.Trigger>
      <Menu.Dropdown>
        <Menu.Item onClick={handleImprove}>Improve writing</Menu.Item>
        <Menu.Item onClick={handleFix}>Fix spelling &amp; grammar</Menu.Item>
        <Menu.Item onClick={handleSummarize}>Summarize</Menu.Item>
        <Menu.Divider />
        <Menu.Item onClick={handleAskAi}>Ask AI…</Menu.Item>
      </Menu.Dropdown>
    </Menu.Root>
  );
}

// ── Main toolbar component ────────────────────────────────────────────────────

/**
 * Custom FormattingToolbar that reproduces all BlockNote default toolbar items
 * and appends an AI dropdown when aiEnabled=true and editor is editable.
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
        <AiToolbarMenu
          key="aiMenu"
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
  openSession: (config: AiSessionConfig) => void,
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
