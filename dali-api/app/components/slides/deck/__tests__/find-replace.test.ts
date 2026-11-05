import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { blocksToFragment } from "~/collab/blocknote-server";
import { readDeck } from "~/collab/read-deck.server";
import { addSlide, notesFragment, slideFragment } from "../deck-ops";
import { createDeckUndo } from "../deck-undo";
import { findMatches, plainOf, replaceMatches } from "../find-replace";
import { addTextBox, deleteElements } from "../freeform-ops";
import { deckMap, initDeck, slidesMap } from "../model";

function setup() {
  const doc = new Y.Doc();
  initDeck(doc);
  const a = addSlide(doc, "content", null);
  const b = addSlide(doc, "content", a);
  return { doc, a, b };
}
const write = (doc: Y.Doc, slideId: string, key: string, blocks: unknown[]) => blocksToFragment(blocks as never, key === "notes" ? notesFragment(doc, slideId)! : slideFragment(doc, slideId, key)!);
const para = (content: unknown) => ({ type: "paragraph", content });
const textOf = (doc: Y.Doc, slideId: string, key: string) => readDeck(doc).slides.find((s) => s.id === slideId)!.elements.find((e) => e.id === key)!.text;
const notesOf = (doc: Y.Doc, slideId: string) => readDeck(doc).slides.find((s) => s.id === slideId)!.notes.text;

describe("findMatches", () => {
  it("finds text in slots, free text boxes and notes, slide by slide", () => {
    const { doc, a, b } = setup();
    write(doc, a, "title", [para("Launch plan")]);
    const free = addTextBox(doc, a)!;
    write(doc, a, free, [para("the plan B")]);
    write(doc, a, "notes", [para("say plan twice")]);
    write(doc, b, "title", [para("Plan review")]);
    const found = findMatches(doc, "plan");
    expect(found.map((m) => [m.slideId, m.key])).toEqual([
      [a, "title"],
      [a, free],
      [a, null],
      [b, "title"],
    ]);
  });

  it("ignores case unless asked, and finds several matches in one line", () => {
    const { doc, a } = setup();
    write(doc, a, "title", [para("Cat cat CAT")]);
    expect(findMatches(doc, "cat")).toHaveLength(3);
    expect(findMatches(doc, "cat", { matchCase: true })).toHaveLength(1);
    expect(findMatches(doc, "")).toEqual([]);
  });

  it("skips deleted slides and deleted text boxes", () => {
    const { doc, a } = setup();
    const free = addTextBox(doc, a)!;
    write(doc, a, free, [para("ghost")]);
    expect(findMatches(doc, "ghost")).toHaveLength(1);
    deleteElements(doc, a, [free]);
    expect(findMatches(doc, "ghost")).toHaveLength(0);
  });

  it("matches across formatting runs and inside table cells", () => {
    const { doc, a } = setup();
    write(doc, a, "title", [para([{ type: "text", text: "pla", styles: {} }, { type: "text", text: "n", styles: { bold: true } }])]);
    expect(findMatches(doc, "plan")).toHaveLength(1);
    const free = addTextBox(doc, a)!;
    write(doc, a, free, [{ type: "table", content: { type: "tableContent", rows: [{ cells: ["alpha", "plan b"] }] } }]);
    expect(findMatches(doc, "plan").map((m) => m.key)).toContain(free);
  });
});

describe("replaceMatches", () => {
  it("replaces a match and keeps the formatting around it", () => {
    const { doc, a } = setup();
    write(doc, a, "title", [para([{ type: "text", text: "big ", styles: {} }, { type: "text", text: "cat", styles: { bold: true } }, { type: "text", text: " sat", styles: {} }])]);
    replaceMatches(doc, findMatches(doc, "cat"), "dog");
    const block = readDeck(doc).slides[0].elements.find((e) => e.id === "title")!.blocks[0];
    expect(block.content).toEqual([
      { type: "text", text: "big ", styles: {} },
      { type: "text", text: "dog", styles: { bold: true } },
      { type: "text", text: " sat", styles: {} },
    ]);
  });

  it("replaces every match in a line and with an empty string", () => {
    const { doc, a } = setup();
    write(doc, a, "title", [para("aa bb aa bb aa")]);
    expect(replaceMatches(doc, findMatches(doc, "aa"), "x")).toBe(3);
    expect(textOf(doc, a, "title")).toBe("x bb x bb x");
    replaceMatches(doc, findMatches(doc, " bb"), "");
    expect(textOf(doc, a, "title")).toBe("x x x");
  });

  it("changes text and notes across slides in one undo step", () => {
    const { doc, a, b } = setup();
    write(doc, a, "title", [para("cat one")]);
    write(doc, b, "body", [para("cat two")]);
    write(doc, b, "notes", [para("cat notes")]);
    const undo = createDeckUndo([slidesMap(doc), deckMap(doc)]);
    undo.manager.clear();
    undo.step(() => replaceMatches(doc, findMatches(doc, "cat"), "dog"));
    expect([textOf(doc, a, "title"), textOf(doc, b, "body"), notesOf(doc, b)]).toEqual(["dog one", "dog two", "dog notes"]);
    undo.manager.undo();
    expect([textOf(doc, a, "title"), textOf(doc, b, "body"), notesOf(doc, b)]).toEqual(["cat one", "cat two", "cat notes"]);
    expect(undo.manager.canUndo()).toBe(false);
    undo.manager.redo();
    expect(textOf(doc, a, "title")).toBe("dog one");
  });

  it("does nothing for no matches", () => {
    const { doc } = setup();
    expect(replaceMatches(doc, [], "x")).toBe(0);
  });

  it("keeps a concurrent edit made on another client", () => {
    const { doc, a } = setup();
    write(doc, a, "title", [para("the cat sat")]);
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    const send = (from: Y.Doc, to: Y.Doc) => Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));

    replaceMatches(doc, findMatches(doc, "cat"), "dog");
    const node = findMatches(other, "sat")[0].node;
    node.insert(node.length, " down");

    send(doc, other);
    send(other, doc);
    expect(textOf(doc, a, "title")).toBe("the dog sat down");
    expect(textOf(other, a, "title")).toBe("the dog sat down");
  });

  it("keeps a concurrent edit inside the replaced word's neighbours", () => {
    const { doc, a } = setup();
    write(doc, a, "title", [para("one cat two")]);
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    replaceMatches(doc, findMatches(doc, "cat"), "dog");
    const node = findMatches(other, "one")[0].node;
    node.insert(0, "so ");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc)));
    expect(plainOf(findMatches(doc, "dog")[0].node)).toBe("so one dog two");
  });
});
