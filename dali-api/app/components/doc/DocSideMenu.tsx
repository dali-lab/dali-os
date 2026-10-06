// Custom drag-handle side menu for DocEditor (A8).
//
// Notion-ordered items:
//   1. Duplicate — deep-copies the block (new IDs) immediately after itself.
//   2. Colors    — BlockNote's BlockColorsItem (text + background sub-menu).
//   3. Delete    — BlockNote's RemoveBlockItem.
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
import { useCallback } from "react";
import type { FC } from "react";
import type { SideMenuProps } from "@blocknote/react";

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

// ── Custom DragHandleMenu ────────────────────────────────────────────────────

function DaliDragHandleMenu() {
  return (
    <DragHandleMenu>
      <DuplicateBlockItem>Duplicate</DuplicateBlockItem>
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
