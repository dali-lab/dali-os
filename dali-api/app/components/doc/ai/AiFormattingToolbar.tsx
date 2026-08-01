// AiFormattingToolbar — replaces the plain <FormattingToolbar /> in DocEditorImpl.
//
// Renders all default BlockNote toolbar children (via getFormattingToolbarItems)
// PLUS, when AI is enabled and the editor is editable, an "AI ✦" dropdown button
// that operates on the CURRENT TEXT SELECTION (which survives in the floating
// toolbar — no "/" was typed).
//
// Selection-scoped AI actions:
//   Improve writing   → replaceBlocks(selectedBlockIds, newBlocks) — single undo step
//   Fix spelling      → replaceBlocks(selectedBlockIds, newBlocks) — single undo step
//   Summarize         → insert after last selected block (never destroys content)
//   Ask AI…           → prompt → replaceBlocks(selectedBlockIds, newBlocks)
//                       (selection-scoped Ask AI rewrites the selection, Notion parity)
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
import { useDialog } from "~/components/ui/dialog";
import {
  runAiAction,
  getSelectionContext,
  type AiScope,
} from "./AiSlashMenuItems";
import type { DocEditorInstance } from "../schema/build";

// ── Prop types ────────────────────────────────────────────────────────────────

interface AiFormattingToolbarProps {
  aiEnabled?: boolean;
  editable?: boolean;
}

// ── AI dropdown menu ──────────────────────────────────────────────────────────

function AiToolbarMenu({
  editor,
}: {
  editor: DocEditorInstance;
}) {
  const Components = useComponentsContext()!;
  const toast = useToast();
  const dialog = useDialog();

  const toastError = (m: string) => toast.error(m);
  const toastWarn = (m: string) => toast.info(m);

  /**
   * Get the selection context and determine the "after block" for placeholder
   * insertion (the last selected block, which is outside the replacement scope
   * in the sense that it's identified first before any mutation).
   */
  async function withSelectionContext<T>(
    fn: (ctx: {
      context: string;
      scopeBlockIds: string[];
      afterBlock: { id: string };
    }) => Promise<T>,
  ): Promise<T | null> {
    const { markdown, blockIds } = await getSelectionContext(editor);
    if (!blockIds.length) {
      toast.error("No text selected.");
      return null;
    }
    // afterBlock = the last selected block. The placeholder goes after it.
    // On success, for replace actions: replaceBlocks(blockIds, newBlocks) then
    // remove placeholder; for insert: replace placeholder.
    const lastBlockId = blockIds[blockIds.length - 1];
    return fn({
      context: markdown,
      scopeBlockIds: blockIds,
      afterBlock: { id: lastBlockId },
    });
  }

  const handleImprove = () => {
    void withSelectionContext(({ context, scopeBlockIds, afterBlock }) =>
      runAiAction({
        editor,
        action: "improve",
        context,
        scopeBlockIds,
        afterBlock,
        toastError,
        toastWarn,
      }),
    );
  };

  const handleFix = () => {
    void withSelectionContext(({ context, scopeBlockIds, afterBlock }) =>
      runAiAction({
        editor,
        action: "fix",
        context,
        scopeBlockIds,
        afterBlock,
        toastError,
        toastWarn,
      }),
    );
  };

  const handleSummarize = () => {
    void withSelectionContext(({ context, scopeBlockIds, afterBlock }) => {
      // Summarize never replaces selection — insert after last selected block.
      return runAiAction({
        editor,
        action: "summarize",
        context,
        // Empty scopeBlockIds → runAiAction uses the insert-after path.
        scopeBlockIds: [],
        afterBlock,
        toastError,
        toastWarn,
      });
      void scopeBlockIds; // used only to confirm selection exists
    });
  };

  const handleAskAi = () => {
    void (async () => {
      const instruction = await dialog.prompt({
        title: "Ask AI",
        label: "What would you like AI to write or do?",
        placeholder: "e.g. Rewrite as bullet points, expand this section…",
      });
      if (!instruction) return;

      await withSelectionContext(({ context, scopeBlockIds, afterBlock }) =>
        runAiAction({
          editor,
          action: "prompt",
          instruction,
          context,
          // Selection Ask AI replaces the selection (Notion parity).
          scopeBlockIds,
          afterBlock,
          toastError,
          toastWarn,
        }),
      );
    })();
  };

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
  const showAi = props.aiEnabled && (props.editable ?? true);

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
      {showAi && <AiToolbarMenu key="aiMenu" editor={editor} />}
    </FormattingToolbar>
  );
}

// Factory that captures aiEnabled/editable in a stable component identity
// so FormattingToolbarController doesn't see a new component ref each render
// (which would cause the toolbar to remount on every editor state change).
//
// Usage: buildAiFormattingToolbar(aiEnabled, editable) → component, memoized
// by the caller with useMemo.
export function buildAiFormattingToolbar(
  aiEnabled: boolean,
  editable: boolean,
): () => React.JSX.Element {
  return function AiFormattingToolbarInstance() {
    return <AiFormattingToolbar aiEnabled={aiEnabled} editable={editable} />;
  };
}
