// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PresentDeck } from "../deck-source";
import { positionFor, useDeckRender } from "../useDeckRender";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let out: ReturnType<typeof useDeckRender>;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const slide = (id: string, skipped = false) => ({ id, pos: 1, layoutId: "blank", elements: [], ...(skipped ? { skipped: true } : {}) });
const deck = (...slides: ReturnType<typeof slide>[]): PresentDeck => ({ themeId: "dali-dark", slides, notes: {} });

function Probe({ deck: d }: { deck: PresentDeck }) {
  out = useDeckRender(d);
  return null;
}
const mount = (d: PresentDeck) => act(() => root.render(createElement(Probe, { deck: d })));

describe("skipped slides in a presentation or a follow", () => {
  it("never appear in the sequence the presenter and followers step through", () => {
    mount(deck(slide("a"), slide("b", true), slide("c")));
    expect(out.slideIds).toEqual(["a", "c"]);
  });

  it("keeps showing a deck whose slides are all skipped", () => {
    mount(deck(slide("a", true), slide("b", true)));
    expect(out.slideIds).toEqual(["a", "b"]);
  });

  it("falls back to the first slide when the live position is a skipped slide", () => {
    mount(deck(slide("a"), slide("b", true), slide("c")));
    expect(positionFor(out.slideIds, out.stepsOf, "b", 0)).toBeNull();
    expect(positionFor(out.slideIds, out.stepsOf, "c", 0)).toEqual({ index: 1, step: 0 });
  });

  it("indexes build steps against the presented slides", () => {
    const withBuild = { ...slide("c"), elements: [{ id: "x", kind: "text", slot: null, z: 1, blocks: [], src: null, alt: null, textStyle: null, build: 2 }] };
    mount(deck(slide("a", true), withBuild as never));
    expect(out.slideIds).toEqual(["c"]);
    expect(out.stepsOf(0)).toBe(2);
  });
});
