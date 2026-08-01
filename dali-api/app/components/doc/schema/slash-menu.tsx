// "/" menu contents, trimmed to the app's command set: text, h1–h3, lists,
// todo, quote, code, divider, toggle, callout, table (+ image when enabled).
//
// BlockNote's defaults are schema-driven (an item only appears if its block is
// registered), so most gating already happened in buildSchema. The allowlist
// below removes what remains outside the app set (toggle headings, emoji) and
// guards against upstream additions. The custom callout item is spliced into
// the existing "Basic blocks" group — NOT appended — so the menu renders one
// group header (appending created a duplicate group, and with it the spike's
// duplicate React key bug).

import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import { getDefaultReactSlashMenuItems } from "@blocknote/react";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import { insertItemIntoGroup } from "../blocks-util";
import type { Features } from "../features";
import type { DocEditorInstance } from "./build";

// DefaultReactSuggestionItem's type omits `key`, but the runtime objects carry
// it (spread from the core items) — it's the only stable, locale-independent
// handle for filtering.
type KeyedItem = DefaultReactSuggestionItem & { key?: string };

const ALLOWED_KEYS = new Set([
  "paragraph",
  "heading",
  "heading_2",
  "heading_3",
  "bullet_list",
  "numbered_list",
  "check_list",
  "quote",
  "code_block",
  "divider",
  "toggle_list",
  "table",
  "image",
]);

function calloutItem(editor: DocEditorInstance): KeyedItem {
  return {
    key: "callout",
    title: "Callout",
    subtext: "Colored box for tips and warnings",
    aliases: ["callout", "info", "tip", "warning", "note"],
    // Same group as the stock basic blocks, resolved through the dictionary so
    // it matches whatever locale the defaults used.
    group: (editor.dictionary.slash_menu.paragraph as { group: string }).group,
    icon: (
      <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>
        💡
      </span>
    ),
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, { type: "callout" });
    },
  };
}

/** Full item list for a feature set (unfiltered by query). */
export function getDocSlashMenuItems(
  editor: DocEditorInstance,
  features: Features,
  aiItems: DefaultReactSuggestionItem[] = [],
): DefaultReactSuggestionItem[] {
  const defaults = (getDefaultReactSlashMenuItems(editor) as KeyedItem[]).filter(
    (item) => item.key !== undefined && ALLOWED_KEYS.has(item.key),
  );
  const standard = features.richBlocks
    ? insertItemIntoGroup(defaults, calloutItem(editor))
    : defaults;
  // AI items go first so they appear above "Basic blocks" — same order as Notion.
  return aiItems.length > 0 ? [...aiItems, ...standard] : standard;
}

/** getItems for SuggestionMenuController (query-filtered on title/aliases). */
export async function getFilteredDocSlashMenuItems(
  editor: DocEditorInstance,
  features: Features,
  query: string,
  aiItems: DefaultReactSuggestionItem[] = [],
): Promise<DefaultReactSuggestionItem[]> {
  return filterSuggestionItems(getDocSlashMenuItems(editor, features, aiItems), query);
}
