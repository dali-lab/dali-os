import { describe, expect, it } from "vitest";
import { clickIntent, type ClickIntent } from "~/components/drive/column-click";

const plain = { metaKey: false, ctrlKey: false, shiftKey: false, anchorInPool: false, suppressed: false };

describe("clickIntent", () => {
  it("selects on a plain click, with or without an anchor", () => {
    expect(clickIntent(plain)).toBe("select");
    expect(clickIntent({ ...plain, anchorInPool: true })).toBe("select");
  });

  it("opens on a tap, since touch has no double-click", () => {
    expect(clickIntent({ ...plain, touch: true })).toBe("open");
    expect(clickIntent({ ...plain, touch: true, anchorInPool: true })).toBe("open");
    expect(clickIntent({ ...plain, touch: true, shiftKey: true })).toBe("open");
  });

  it("keeps the modifiers and the drag guard working from touch too", () => {
    expect(clickIntent({ ...plain, touch: true, metaKey: true })).toBe("toggle");
    expect(clickIntent({ ...plain, touch: true, shiftKey: true, anchorInPool: true })).toBe("range");
    expect(clickIntent({ ...plain, touch: true, suppressed: true })).toBe("ignore");
  });

  it.each([{ metaKey: true }, { ctrlKey: true }, { metaKey: true, ctrlKey: true }])("toggles on %o", (mods) => {
    expect(clickIntent({ ...plain, ...mods })).toBe("toggle");
    expect(clickIntent({ ...plain, ...mods, anchorInPool: true })).toBe("toggle");
  });

  it("extends a range from an anchor in the same pool of rows", () => {
    expect(clickIntent({ ...plain, shiftKey: true, anchorInPool: true })).toBe("range");
  });

  it("treats shift-click as a plain click when the anchor is elsewhere", () => {
    expect(clickIntent({ ...plain, shiftKey: true, anchorInPool: false })).toBe("select");
  });

  it("lets cmd/ctrl win over shift", () => {
    expect(clickIntent({ ...plain, metaKey: true, shiftKey: true, anchorInPool: true })).toBe("toggle");
    expect(clickIntent({ ...plain, ctrlKey: true, shiftKey: true, anchorInPool: true })).toBe("toggle");
  });

  it("ignores the click that ends a drag, whatever the modifiers", () => {
    const bools = [false, true];
    for (const metaKey of bools)
      for (const ctrlKey of bools)
        for (const shiftKey of bools)
          for (const anchorInPool of bools) {
            const out: ClickIntent = clickIntent({ metaKey, ctrlKey, shiftKey, anchorInPool, suppressed: true });
            expect(out).toBe("ignore");
          }
  });

  it("never returns anything but the five intents", () => {
    const bools = [false, true];
    const seen = new Set<string>();
    for (const metaKey of bools)
      for (const ctrlKey of bools)
        for (const shiftKey of bools)
          for (const anchorInPool of bools)
            for (const suppressed of bools)
              for (const touch of bools)
                seen.add(clickIntent({ metaKey, ctrlKey, shiftKey, anchorInPool, suppressed, touch }));
    expect([...seen].sort()).toEqual(["ignore", "open", "range", "select", "toggle"]);
  });
});
