// Custom drag-handle side menu for DocEditor (A8).
//
// Notion-ordered items:
//   1. Duplicate     — deep-copies the block (new IDs) immediately after itself.
//   1b. Keep/Revert change — only on a block carrying a reserved Enhance mark
//       (specs/meeting-recording-rail.md Step 2); see EnhanceReviewMenuItems.
//   2. Colors        — BlockNote's BlockColorsItem (text + background sub-menu).
//   3. Delete        — BlockNote's RemoveBlockItem.
//
// Commenting starts from a text selection (the formatting toolbar), not here.
//
// Usage: <DaliSideMenuController /> as a child of BlockNoteView
// (with the BlockNoteView's built-in sideMenu={false} to disable the default one).

import { SideMenuExtension } from "@blocknote/core/extensions";
import {
  BlockColorsItem,
  DragHandleMenu,
  RemoveBlockItem,
  SideMenu,
  SideMenuController,
  useBlockNoteEditor,
  useComponentsContext,
  useExtensionState,
} from "@blocknote/react";
import { useCallback, useContext } from "react";
import type { FC } from "react";
import type { SideMenuProps } from "@blocknote/react";
import { markOfProps, firstLineOf } from "~/components/meeting-recorder/enhance-plan";
import { blockOwnText } from "./schema/configs";
import { EnhanceReviewContext } from "./enhance-review-context";

// ── 1. Duplicate item ────────────────────────────────────────────────────────

function DuplicateBlockItem({ children }: { children: React.ReactNode }) {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<any, any, any>();

  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });

  const onClick = useCallback(() => {
    if (!block) return;
    // Recursively strip `id` so BlockNote generates fresh IDs for each node.
    const stripIds = (b: Record<string, unknown>): Record<string, unknown> => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, ...rest } = b;
      if (Array.isArray(rest.children)) {
        rest.children = (rest.children as Record<string, unknown>[]).map(stripIds);
      }
      return rest;
    };
    const copy = stripIds(block as unknown as Record<string, unknown>);
    editor.insertBlocks(
      [copy as Parameters<typeof editor.insertBlocks>[0][number]],
      block,
      "after",
    );
  }, [editor, block]);

  if (!block) return null;

  return (
    <Components.Generic.Menu.Item className={"bn-menu-item"} onClick={onClick}>
      {children}
    </Components.Generic.Menu.Item>
  );
}

// ── 1b. Keep change / Revert change (specs/meeting-recording-rail.md Step 2) ─
// Shown only when the hovered block carries a reserved Enhance mark, and
// only when a recording hook up the tree provided handlers (documents.
// $pageId.tsx wraps the page in EnhanceReviewContext when one is mounted).
// The side menu stays generic otherwise — it has no idea what "Enhance"
// means, only that this context exists or doesn't.

function EnhanceReviewMenuItems() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<any, any, any>();
  const review = useContext(EnhanceReviewContext);

  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });

  if (!review || !block) return null;
  const mark = markOfProps(block.props as Record<string, unknown>);
  if (!mark) return null;

  const firstLine = firstLineOf(blockOwnText(block as Parameters<typeof blockOwnText>[0])) || "this block";

  return (
    <>
      <Components.Generic.Menu.Item className="bn-menu-item" onClick={() => review.keepBlock(block.id)}>
        {`Keep change: ${firstLine}`}
      </Components.Generic.Menu.Item>
      <Components.Generic.Menu.Item className="bn-menu-item" onClick={() => review.revertBlock(block.id)}>
        {`Revert change: ${firstLine}`}
      </Components.Generic.Menu.Item>
    </>
  );
}

// ── Custom DragHandleMenu ────────────────────────────────────────────────────

function DaliDragHandleMenu() {
  return (
    <DragHandleMenu>
      <DuplicateBlockItem>Duplicate</DuplicateBlockItem>
      <EnhanceReviewMenuItems />
      <BlockColorsItem>Colors</BlockColorsItem>
      <RemoveBlockItem>Delete</RemoveBlockItem>
    </DragHandleMenu>
  );
}

// ── Public: SideMenuController wired to the Dali menu ───────────────────────

const DaliMenu: FC<SideMenuProps> = () => <SideMenu dragHandleMenu={DaliDragHandleMenu} />;

/**
 * Drop-in replacement for BlockNote's default SideMenuController.
 *
 * Mount this as a child of <BlockNoteView sideMenu={false}> (disabled so the
 * default controller doesn't also render).
 */
export function DaliSideMenuController() {
  return <SideMenuController sideMenu={DaliMenu} />;
}
