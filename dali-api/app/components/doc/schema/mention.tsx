// Mention inline content: chip renderer + "@" suggestion items backed by the
// real member-search endpoint. Port of app/components/editor/mention.tsx —
// the stored shape {id, label: handle} is 1:1 with the TipTap node attrs
// (extractMentionUserIds and the PM→BlockNote mapper depend on it).

import { createReactInlineContentSpec } from "@blocknote/react";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
// Type-only: erased at runtime, so no module cycle with build.ts (which
// imports MentionSpec as a value).
import type { DocEditorInstance } from "./build";
import { mentionConfig } from "./configs";

export type MentionUser = {
  id: string;
  name: string;
  handle: string;
  photoUrl?: string | null;
};

// Same chip styling as the legacy MENTION_CLASS.
const MENTION_CLASS =
  "rounded bg-accent-coral/15 px-1 py-0.5 font-medium text-accent-coral";

export const MentionSpec = createReactInlineContentSpec(mentionConfig, {
  render: ({ inlineContent }) => (
    <span className={MENTION_CLASS} data-mention-id={inlineContent.props.id}>
      @{inlineContent.props.label}
    </span>
  ),
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

/**
 * Async "@" suggestion items for SuggestionMenuController. The server result
 * is authoritative (already filtered on name/handle), so BlockNote's local
 * filterSuggestionItems is deliberately skipped.
 */
export async function getMentionMenuItems(
  editor: DocEditorInstance,
  query: string,
  search: (q: string) => Promise<MentionUser[]> = searchMentionableUsers,
): Promise<DefaultReactSuggestionItem[]> {
  const users = await search(query);
  return users.map((user) => ({
    title: user.name,
    subtext: `@${user.handle}`,
    onItemClick: () => {
      editor.insertInlineContent([
        { type: "mention", props: { id: user.id, label: user.handle } },
        " ",
      ]);
    },
  }));
}
