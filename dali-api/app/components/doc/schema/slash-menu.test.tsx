// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import { en } from "@blocknote/core/locales";
import { locales as multiColumnLocales } from "@blocknote/xl-multi-column";
import { EDITOR_PRESETS, type EditorPresetName } from "../features";
import { buildSchema, type DocEditorInstance } from "./build";
import { getDocSlashMenuItems, getFilteredDocSlashMenuItems } from "./slash-menu";

function editorFor(preset: EditorPresetName): DocEditorInstance {
  return BlockNoteEditor.create({
    schema: buildSchema(EDITOR_PRESETS[preset]),
    dictionary: { ...en, multi_column: multiColumnLocales.en },
  }) as unknown as DocEditorInstance;
}

function groupRuns(items: { group?: string }[]): (string | undefined)[] {
  const runs: (string | undefined)[] = [];
  for (const { group } of items) {
    if (runs[runs.length - 1] !== group) runs.push(group);
  }
  return runs;
}

const aiItem = { title: "Ask AI", group: "AI", onItemClick: () => {} };

describe("getDocSlashMenuItems", () => {
  // BlockNote keys each section header by group name, so a group split in two
  // gives two headers the same key and React leaves stale headers on screen.
  it.each(Object.keys(EDITOR_PRESETS) as EditorPresetName[])("keeps each group in one run for the %s preset", (preset) => {
    const items = getDocSlashMenuItems(editorFor(preset), EDITOR_PRESETS[preset], [aiItem], vi.fn());
    const runs = groupRuns(items);

    expect(new Set(runs).size).toBe(runs.length);
  });

  it("places Page Break with the basic blocks, before Advanced", () => {
    const titles = getDocSlashMenuItems(editorFor("document"), EDITOR_PRESETS.document, [], vi.fn()).map((i) => i.title);

    expect(titles.indexOf("Page Break")).toBe(titles.indexOf("Task") + 1);
    expect(titles.indexOf("Page Break")).toBeLessThan(titles.indexOf("Table"));
  });

  it("leaves Page Break out when the feature is off", () => {
    const features = { ...EDITOR_PRESETS.document, pageBreak: false };
    const titles = getDocSlashMenuItems(editorFor("document"), features, [], vi.fn()).map((i) => i.title);

    expect(titles).not.toContain("Page Break");
  });
});

describe("getFilteredDocSlashMenuItems", () => {
  it("returns one item in one group for /task", async () => {
    const items = await getFilteredDocSlashMenuItems(editorFor("document"), EDITOR_PRESETS.document, "task", [], vi.fn());

    expect(items.map((i) => i.title)).toEqual(["Task"]);
    expect(groupRuns(items)).toEqual(["Basic blocks"]);
  });
});
