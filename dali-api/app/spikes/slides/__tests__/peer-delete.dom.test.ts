// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import { withCollaboration } from "@blocknote/core/yjs";
import * as Y from "yjs";
import { addSlide, addTextElement, initDeck, slidesMap, textFragment, tombstoneSlide } from "../deck-model";

function pair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  initDeck(a);
  addSlide(a, "S", 1);
  addTextElement(a, "S", "t", undefined, "hello");
  addSlide(a, "T", 2);
  addTextElement(a, "T", "t");
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  let online = true;
  const queue: Array<[Y.Doc, Uint8Array]> = [];
  const wire = (from: Y.Doc, to: Y.Doc) =>
    from.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin === "wire") return;
      if (online) Y.applyUpdate(to, u, "wire");
      else queue.push([to, u]);
    });
  wire(a, b);
  wire(b, a);
  return {
    a,
    b,
    offline: () => (online = false),
    online: () => {
      online = true;
      for (const [to, u] of queue.splice(0)) Y.applyUpdate(to, u, "wire");
    },
  };
}

function mount(ydoc: Y.Doc, slideId: string) {
  const editor = BlockNoteEditor.create(
    withCollaboration({
      collaboration: { fragment: textFragment(ydoc, slideId, "t"), user: { name: "Bo", color: "#336699" } },
    }) as never,
  );
  const el = document.createElement("div");
  document.body.appendChild(el);
  editor.mount(el);
  return editor;
}

const pm = (e: BlockNoteEditor) => e.prosemirrorState.doc.textContent;
const errors: unknown[] = [];
const errSpy = () => vi.spyOn(console, "error").mockImplementation((...a) => void errors.push(a));

afterEach(() => {
  errors.length = 0;
  vi.restoreAllMocks();
});

describe("peer deletes the slide you are typing in", () => {
  it("tombstone: B keeps a live editor, typing still lands in the doc, nothing throws", () => {
    errSpy();
    const { a, b } = pair();
    const ed = mount(b, "S");
    expect(pm(ed)).toBe("hello");

    tombstoneSlide(a, "S");
    expect(slidesMap(b).get("S")!.get("deleted")).toBe(true);
    expect(pm(ed)).toBe("hello");

    expect(() => ed.insertInlineContent(" world")).not.toThrow();
    expect(pm(ed)).toBe(" worldhello");
    expect(textFragment(b, "S", "t").toString()).toContain(" worldhello");
    expect(textFragment(a, "S", "t").toString()).toContain(" worldhello");
    expect(errors).toEqual([]);
  });

  it("tombstone is reversible: an undelete keeps every character typed after the delete", () => {
    const { a, b } = pair();
    const ed = mount(b, "S");
    tombstoneSlide(a, "S");
    ed.insertInlineContent("!!");
    slidesMap(a).get("S")!.set("deleted", false);
    expect(slidesMap(b).get("S")!.get("deleted")).toBe(false);
    expect(textFragment(a, "S", "t").toString()).toContain("!!");
  });

  it("hard Y.Map.delete: record what B's editor and doc do", () => {
    errSpy();
    const { a, b } = pair();
    const ed = mount(b, "S");
    const frag = textFragment(b, "S", "t");

    slidesMap(a).delete("S");

    const out: Record<string, unknown> = {};
    out.slideGoneOnB = !slidesMap(b).has("S");
    out.fragmentDeletedOnB = (frag as unknown as { _item: { deleted: boolean } })._item.deleted;
    out.editorTextAfterDelete = pm(ed);
    out.fragmentTextAfterDelete = frag.toString();
    let threw: unknown = null;
    try {
      ed.insertInlineContent(" typed after delete");
    } catch (e) {
      threw = String(e);
    }
    out.threwOnType = threw;
    out.editorTextAfterType = pm(ed);
    out.fragmentTextAfterType = frag.toString();
    out.consoleErrors = errors.length;
    console.log("HARD-DELETE-OBSERVATION " + JSON.stringify(out));

    expect(out.slideGoneOnB).toBe(true);
    expect(out.fragmentDeletedOnB).toBe(true);
    expect(out.threwOnType).toBeNull();
    expect(out.consoleErrors).toBe(0);
    expect(out.editorTextAfterDelete).toBe("hello");
    expect(out.fragmentTextAfterDelete).toBe("");
    expect(out.editorTextAfterType).toBe(" typed after deletehello");
    expect(out.fragmentTextAfterType).toBe("");
  });

  it("hard delete concurrent with typing: the typed text is silently lost on every replica", () => {
    const { a, b, offline, online } = pair();
    const ed = mount(b, "S");
    offline();
    slidesMap(a).delete("S");
    ed.insertInlineContent(" concurrent");
    expect(pm(ed)).toBe(" concurrenthello");
    online();
    expect(slidesMap(a).has("S")).toBe(false);
    expect(slidesMap(b).has("S")).toBe(false);
    console.log("CONCURRENT-HARD-DELETE editorStillShows=" + JSON.stringify(pm(ed)));
  });

  it("tombstone concurrent with typing: text survives on every replica", () => {
    const { a, b, offline, online } = pair();
    const ed = mount(b, "S");
    offline();
    tombstoneSlide(a, "S");
    ed.insertInlineContent(" concurrent");
    online();
    expect(textFragment(a, "S", "t").toString()).toContain(" concurrenthello");
    expect(slidesMap(a).get("S")!.get("deleted")).toBe(true);
  });
});
