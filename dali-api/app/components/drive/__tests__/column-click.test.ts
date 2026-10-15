import { describe, expect, it } from "vitest";
import { clickIntent, type ClickIntent } from "~/components/drive/column-click";

const plain = { metaKey: false, ctrlKey: false, shiftKey: false, anchorInPool: false, suppressed: false };

describe("clickIntent", () => {
  it("opens on a plain click, with or without an anchor", () => {
    expect(clickIntent(plain)).toBe("open");
    expect(clickIntent({ ...plain, anchorInPool: true })).toBe("open");
  });

  it.each([{ metaKey: true }, { ctrlKey: true }, { metaKey: true, ctrlKey: true }])("toggles on %o", (mods) => {
    expect(clickIntent({ ...plain, ...mods })).toBe("toggle");
    expect(clickIntent({ ...plain, ...mods, anchorInPool: true })).toBe("toggle");
  });

  it("extends a range from an anchor in the same pool of rows", () => {
    expect(clickIntent({ ...plain, shiftKey: true, anchorInPool: true })).toBe("range");
  });

  it("treats shift-click as a plain click when the anchor is elsewhere", () => {
    expect(clickIntent({ ...plain, shiftKey: true, anchorInPool: false })).toBe("open");
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

  it("never returns anything but the four intents", () => {
    const bools = [false, true];
    const seen = new Set<string>();
    for (const metaKey of bools)
      for (const ctrlKey of bools)
        for (const shiftKey of bools)
          for (const anchorInPool of bools)
            for (const suppressed of bools)
              seen.add(clickIntent({ metaKey, ctrlKey, shiftKey, anchorInPool, suppressed }));
    expect([...seen].sort()).toEqual(["ignore", "open", "range", "toggle"]);
  });
});
