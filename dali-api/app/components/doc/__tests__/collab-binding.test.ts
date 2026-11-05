import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { resolveFragment, undoOptions } from "../collab-binding";
import { EDITOR_PRESETS, resolveFeatures } from "../features";

describe("resolveFragment", () => {
  it("binds documents to the blocknote fragment by default", () => {
    const doc = new Y.Doc();
    expect(resolveFragment(doc, {})).toBe(doc.getXmlFragment("blocknote"));
  });

  it("binds to the host's fragment when one is given", () => {
    const doc = new Y.Doc();
    const own = new Y.XmlFragment();
    doc.getMap("m").set("f", own);
    expect(resolveFragment(doc, { fragment: own })).toBe(own);
    expect(resolveFragment(doc, { fragment: own })).not.toBe(doc.getXmlFragment("blocknote"));
  });
});

describe("undoOptions", () => {
  it("leaves BlockNote's own undo on by default", () => {
    expect(undoOptions({})).toEqual({ extensions: [] });
  });

  it("swaps in the host's undo and disables yUndo", () => {
    const ext = { key: "deckUndo" };
    expect(undoOptions({ undoExtension: ext })).toEqual({ extensions: [ext], disableExtensions: ["yUndo"] });
  });
});

describe("slide preset", () => {
  it("is minimal: mentions and images only, nothing that needs a gutter or block library", () => {
    expect(resolveFeatures("slide")).toEqual({ mentions: true, images: true });
    expect(EDITOR_PRESETS.slide.columns).toBeUndefined();
    expect(EDITOR_PRESETS.slide.components).toBeUndefined();
  });
});
