// Mention inline content: chip renderer + "@" suggestion items backed by the
// real member-search endpoint. Port of app/components/editor/mention.tsx —
// the stored shape {id, label: handle} is 1:1 with the TipTap node attrs
// (extractMentionUserIds and the PM→BlockNote mapper depend on it).
//
// Page mentions (pageMention node) are a separate spec with stored shape
// {pageId, label: title snapshot}. A separate node type means the server
// walkers can distinguish user vs page mentions without inspecting props, and
// existing persisted "mention" nodes are fully backward-compatible.

import { createReactInlineContentSpec } from "@blocknote/react";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
// Type-only: erased at runtime, so no module cycle with build.ts (which
// imports MentionSpec as a value).
import type { DocEditorInstance } from "./build";
import { mentionConfig, pageMentionConfig } from "./configs";

export type MentionUser = {
  id: string;
  name: string;
  handle: string;
  photoUrl?: string | null;
};

export type MentionPage = {
  id: string;
  title: string;
  iconEmoji?: string | null;
};

// Same chip styling as the legacy MENTION_CLASS.
const MENTION_CLASS =
  "rounded bg-accent-coral/15 px-1 py-0.5 font-medium text-accent-coral";

// Page mention chip: muted blue tint to visually distinguish from @user coral
// mentions. Click navigates to the page (window.location so it works inside
// the contenteditable tree in both editable and read-only contexts).
const PAGE_MENTION_CLASS =
  "rounded bg-primary/10 px-1 py-0.5 font-medium text-primary cursor-pointer hover:bg-primary/20";

export const MentionSpec = createReactInlineContentSpec(mentionConfig, {
  render: ({ inlineContent }) => (
    <span className={MENTION_CLASS} data-mention-id={inlineContent.props.id}>
      @{inlineContent.props.label}
    </span>
  ),
});

export const PageMentionSpec = createReactInlineContentSpec(pageMentionConfig, {
  render: ({ inlineContent }) => {
    const pageId = inlineContent.props.pageId;
    const label = inlineContent.props.label || "Untitled";
    return (
      <span
        className={PAGE_MENTION_CLASS}
        data-page-mention-id={pageId}
        onClick={(e) => {
          e.preventDefault();
          if (pageId) window.location.href = `/documents/${pageId}`;
        }}
        title={`Open page: ${label}`}
      >
        📄 {label}
      </span>
    );
  },
});

/** Thin wrapper over the member-search endpoint (session-authed). */
export async function searchMentionableUsers(q: string): Promise<MentionUser[]> {
  try {
    const res = await fetch(`/api/mentions/search?q=${encodeURIComponent(q)}`, {
      credentials: "include",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { members?: MentionUser[] };
    return data.members ?? [];
  } catch {
    return [];
  }
}

/** Thin wrapper over the page-mention search endpoint (session-authed, permission-scoped). */
export async function searchMentionablePages(q: string): Promise<MentionPage[]> {
  try {
    const res = await fetch(
      `/api/mentions/pages?q=${encodeURIComponent(q)}`,
      { credentials: "include" },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { pages?: MentionPage[] };
    return data.pages ?? [];
  } catch {
    return [];
  }
}

/**
 * Async "@" suggestion items for SuggestionMenuController. Returns People
 * first (group: "People"), then Pages (group: "Pages"). Both are filtered
 * server-side so BlockNote's local filterSuggestionItems is skipped.
 */
export async function getMentionMenuItems(
  editor: DocEditorInstance,
  query: string,
  searchUsers: (q: string) => Promise<MentionUser[]> = searchMentionableUsers,
  searchPages: (q: string) => Promise<MentionPage[]> = searchMentionablePages,
): Promise<DefaultReactSuggestionItem[]> {
  const [users, pages] = await Promise.all([
    searchUsers(query),
    searchPages(query),
  ]);

  const userItems: DefaultReactSuggestionItem[] = users.map((user) => ({
    title: user.name,
    subtext: `@${user.handle}`,
    group: "People",
    onItemClick: () => {
      editor.insertInlineContent([
        { type: "mention", props: { id: user.id, label: user.handle } },
        " ",
      ]);
    },
  }));

  const pageItems: DefaultReactSuggestionItem[] = pages.map((page) => ({
    title: page.title || "Untitled",
    subtext: "Page",
    group: "Pages",
    onItemClick: () => {
      editor.insertInlineContent([
        {
          type: "pageMention",
          props: { pageId: page.id, label: page.title || "Untitled" },
        },
        " ",
      ]);
    },
  }));

  return [...userItems, ...pageItems];
}
