// Custom drag-handle side menu for DocEditor (A8).
//
// Notion-ordered items:
//   1. Duplicate — deep-copies the block (new IDs) immediately after itself.
//   2. Colors    — BlockNote's BlockColorsItem (text + background sub-menu).
//   3. Comment   — only when the editor has a comments extension AND canComment=true;
//                  selects the block then calls CommentsExtension.startPendingComment().
//   4. Delete    — BlockNote's RemoveBlockItem.
//
// Usage: <DaliSideMenuController canComment={...} /> as a child of BlockNoteView
// (with the BlockNoteView's built-in sideMenu={false} to disable the default one).

import type { CommentsExtension } from "@blocknote/core/comments";
import { SideMenuExtension } from "@blocknote/core/extensions";
import {
  BlockColorsItem,
  DragHandleMenu,
  RemoveBlockItem,
  SideMenu,
  SideMenuController,
  useBlockNoteEditor,
  useComponentsContext,
  useExtension,
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

// ── 3. Comment item ──────────────────────────────────────────────────────────
// Sets a selection spanning the block, then triggers the floating composer via
// CommentsExtension.startPendingComment() — the same path the formatting
// toolbar's AddCommentButton uses.

function CommentOnBlockItem({ children }: { children: React.ReactNode }) {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<any, any, any>();

  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });

  // useExtension("comments") returns the live extension instance.
  // This component is only rendered when the extension is confirmed present.
  const commentsExt = useExtension("comments") as ReturnType<
    ReturnType<typeof CommentsExtension>
  >;

  const onClick = useCallback(() => {
    if (!block) return;
    // Select from block start to block end so the pending comment anchors
    // to the block's text range.
    editor.setSelection(block, block);
    commentsExt.startPendingComment();
  }, [editor, block, commentsExt]);

  if (!block) return null;

  return (
    <Components.Generic.Menu.Item className={"bn-menu-item"} onClick={onClick}>
      {children}
    </Components.Generic.Menu.Item>
  );
}

// ── Custom DragHandleMenu ────────────────────────────────────────────────────

function DaliDragHandleMenu({ canComment }: { canComment: boolean }) {
  const editor = useBlockNoteEditor<any, any, any>();
  // Show comment item only when CommentsExtension is wired AND canComment is true.
  const hasComments = Boolean(editor.getExtension("comments")) && canComment;

  return (
    <DragHandleMenu>
      <DuplicateBlockItem>Duplicate</DuplicateBlockItem>
      <BlockColorsItem>Colors</BlockColorsItem>
      {hasComments && (
        <CommentOnBlockItem>Comment</CommentOnBlockItem>
      )}
      <RemoveBlockItem>Delete</RemoveBlockItem>
    </DragHandleMenu>
  );
}

// ── Public: SideMenuController wired to the Dali menu ───────────────────────

/**
 * Drop-in replacement for BlockNote's default SideMenuController.
 *
 * Mount this as a child of <BlockNoteView sideMenu={false}> (disabled so the
 * default controller doesn't also render).
 *
 * @param canComment Whether the current user may post new comments.
 *   Pass `props.comments?.canComment ?? false` from DocView.
 */
export function DaliSideMenuController({ canComment }: { canComment: boolean }) {
  // Memoize the FC so SideMenuController gets a stable reference — only
  // recreated when canComment changes, avoiding unnecessary menu remounts.
  const DaliMenu: FC<SideMenuProps> = useCallback(
    () => (
      <SideMenu
        dragHandleMenu={() => <DaliDragHandleMenu canComment={canComment} />}
      />
    ),
    [canComment],
  );

  return <SideMenuController sideMenu={DaliMenu} />;
}
