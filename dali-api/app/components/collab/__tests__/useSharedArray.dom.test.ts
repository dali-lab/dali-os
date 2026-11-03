// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as Y from "yjs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const providers: FakeProvider[] = [];
class FakeProvider {
  document: Y.Doc;
  private handlers = new Map<string, () => void>();
  constructor(opts: { document: Y.Doc }) {
    this.document = opts.document;
    providers.push(this);
  }
  on(event: string, fn: () => void) {
    this.handlers.set(event, fn);
  }
  off(event: string) {
    this.handlers.delete(event);
  }
  emit(event: string) {
    this.handlers.get(event)?.();
  }
  destroy() {}
}

vi.mock("@hocuspocus/provider", () => ({ HocuspocusProvider: FakeProvider }));
vi.mock("../util", () => ({ getCollabUrl: () => "ws://test" }));

const { useSharedArray } = await import("../useSharedCollection");

type Item = { key: string; label: string };
type Hook = ReturnType<typeof useSharedArray<Item>>;

let container: HTMLDivElement;
let root: Root;
let hook: Hook;

function Probe({ initial }: { initial: Item[] }) {
  hook = useSharedArray<Item>("form:f1:draft", "token", "items", initial, "key");
  return null;
}

function mount(initial: Item[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(Probe, { initial })));
  const provider = providers[providers.length - 1];
  act(() => provider.emit("synced"));
  return provider.document.getArray<Y.Map<unknown>>("items");
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  providers.length = 0;
});

const seed: Item[] = [
  { key: "a", label: "A" },
  { key: "b", label: "B" },
];

describe("useSharedArray", () => {
  it("seeds an empty room from the initial items", () => {
    mount(seed);
    expect(hook.items).toEqual(seed);
  });

  // Regression: a shallow observer missed edits inside an item, so the
  // builder's list (and Save) never saw an edited question.
  it("shows an in-place replace in items", () => {
    mount(seed);
    act(() => hook.replace(1, { key: "b", label: "B edited" }));
    expect(hook.items).toEqual([
      { key: "a", label: "A" },
      { key: "b", label: "B edited" },
    ]);
  });

  it("shows a remote edit inside an item", () => {
    const yarray = mount(seed);
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(yarray.doc!));
    remote.getArray<Y.Map<unknown>>("items").get(0).set("label", "A remote");
    act(() => Y.applyUpdate(yarray.doc!, Y.encodeStateAsUpdate(remote)));
    expect(hook.items[0]).toEqual({ key: "a", label: "A remote" });
  });

  it("replaces by key when hidden entries shift the raw index", () => {
    const yarray = mount(seed);
    act(() => yarray.insert(0, [new Y.Map<unknown>()]));
    expect(hook.items.map((i) => i.key)).toEqual(["a", "b"]);

    act(() => hook.replace(0, { key: "a", label: "A edited" }));
    expect(yarray.get(0).size).toBe(0);
    expect(hook.items).toEqual([
      { key: "a", label: "A edited" },
      { key: "b", label: "B" },
    ]);
  });

  it("ignores a replace for a key that is no longer in the list", () => {
    mount(seed);
    act(() => hook.replace(0, { key: "gone", label: "X" }));
    expect(hook.items).toEqual(seed);
  });
});
