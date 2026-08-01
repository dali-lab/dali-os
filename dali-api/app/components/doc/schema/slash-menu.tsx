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

import { filterSuggestionItems, getPageBreakSlashMenuItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import { getDefaultReactSlashMenuItems } from "@blocknote/react";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import { insertItemIntoGroup } from "../blocks-util";
import type { Features } from "../features";
import type { DocEditorInstance } from "./build";

// DefaultReactSuggestionItem's type omits `key`, but the runtime objects carry
// it (spread from the core items) — it's the only stable, locale-independent
// handle for filtering.
type KeyedItem = DefaultReactSuggestionItem & { key?: string };

// Base set: always shown when the block is registered.
const ALLOWED_KEYS = new Set([
  "paragraph",
  "heading",
  "heading_2",
  "heading_3",
  // Toggle headings (h1–h3 only; h4–h6 not allowed per Notion convention).
  "toggle_heading",
  "toggle_heading_2",
  "toggle_heading_3",
  "bullet_list",
  "numbered_list",
  "check_list",
  "quote",
  "code_block",
  "divider",
  "toggle_list",
  "table",
  "image",
  "file",
  "video",
  // page_break is handled separately via getPageBreakSlashMenuItems
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
): DefaultReactSuggestionItem[] {
  const defaults = (getDefaultReactSlashMenuItems(editor) as KeyedItem[]).filter(
    (item) => item.key !== undefined && ALLOWED_KEYS.has(item.key),
  );
  let items = defaults;
  if (features.richBlocks) {
    items = insertItemIntoGroup(items, calloutItem(editor));
  }
  if (features.pageBreak) {
    // getPageBreakSlashMenuItems returns [] when the block isn't in the schema.
    // Cast via unknown: the core item type is compatible but the BlockNote
    // generic parameters don't overlap with DocEditorInstance's narrow schema.
    const pbItems = getPageBreakSlashMenuItems(editor as unknown as Parameters<typeof getPageBreakSlashMenuItems>[0]);
    for (const pb of pbItems) {
      items = [...items, pb as unknown as DefaultReactSuggestionItem];
    }
  }
  return items;
}

/** getItems for SuggestionMenuController (query-filtered on title/aliases). */
export async function getFilteredDocSlashMenuItems(
  editor: DocEditorInstance,
  features: Features,
  query: string,
): Promise<DefaultReactSuggestionItem[]> {
  return filterSuggestionItems(getDocSlashMenuItems(editor, features), query);
}
