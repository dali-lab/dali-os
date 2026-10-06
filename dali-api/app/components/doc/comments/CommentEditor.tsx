// The editor every comment is written and shown in: the new-thread composer,
// a thread's reply box, and each posted comment (BlockNote renders those in a
// read-only editor). BlockNote's stock one is a paragraph-only editor with no
// "@" menu, so a handle typed into a comment stayed plain text and notified
// nobody. This one adds the member mention: the schema carries the same
// mention chip the document uses, and "@" opens the people picker.

import {
  BlockNoteSchema,
  createParagraphBlockSpec,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from "@blocknote/core";
import {
  ComponentsContext,
  FormattingToolbar,
  FormattingToolbarController,
  SuggestionMenuController,
  getFormattingToolbarItems,
  useBlockNoteContext,
  useComponentsContext,
  type ComponentProps,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { forwardRef, useMemo, type ReactNode } from "react";
import { MentionSpec, getMentionMenuItems } from "../schema/mention";

// Same trims as BlockNote's default comment schema (one paragraph block, no
// text or background colors), plus the member mention. Page mentions stay a
// document-only feature: a comment body is stored as flat text and mentions.
const {
  textColor: _textColor,
  backgroundColor: _backgroundColor,
  ...commentStyleSpecs
} = defaultStyleSpecs;

export const commentEditorSchema = BlockNoteSchema.create({
  blockSpecs: { paragraph: createParagraphBlockSpec() },
  inlineContentSpecs: { ...defaultInlineContentSpecs, mention: MentionSpec },
  styleSpecs: commentStyleSpecs,
});

const noPages = async () => [];

function CommentFormattingToolbar() {
  const items = getFormattingToolbarItems([]).filter(
    (el) => el.key !== "nestBlockButton" && el.key !== "unnestBlockButton",
  );
  return <FormattingToolbar blockTypeSelectItems={[]}>{items}</FormattingToolbar>;
}

const CommentEditor = forwardRef<HTMLDivElement, ComponentProps["Comments"]["Editor"]>(
  ({ className, onFocus, onBlur, autoFocus, editor, editable }, ref) => {
    const blockNoteContext = useBlockNoteContext();
    return (
      <BlockNoteView
        autoFocus={autoFocus}
        className={className}
        theme={blockNoteContext?.colorSchemePreference}
        editor={editor}
        sideMenu={false}
        slashMenu={false}
        tableHandles={false}
        filePanel={false}
        formattingToolbar={false}
        editable={editable}
        ref={ref}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        <FormattingToolbarController formattingToolbar={CommentFormattingToolbar} />
        {editable && (
          <SuggestionMenuController
            triggerCharacter="@"
            getItems={(query) => getMentionMenuItems(editor as never, query, undefined, noPages)}
          />
        )}
      </BlockNoteView>
    );
  },
);
CommentEditor.displayName = "CommentEditor";

/** Swaps this editor in for BlockNote's own under everything it wraps. */
export function CommentEditorProvider({ children }: { children: ReactNode }) {
  const components = useComponentsContext()!;
  const value = useMemo(
    () => ({ ...components, Comments: { ...components.Comments, Editor: CommentEditor } }),
    [components],
  );
  return <ComponentsContext.Provider value={value}>{children}</ComponentsContext.Provider>;
}
