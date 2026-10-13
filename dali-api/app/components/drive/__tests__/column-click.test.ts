import { describe, expect, it } from "vitest";
import { columnClickIntent, type ColumnClickIntent } from "~/components/drive/column-click";

const plain = { metaKey: false, ctrlKey: false, shiftKey: false, anchorInColumn: false, suppressed: false };

describe("columnClickIntent", () => {
  it("selects on a plain click, with or without an anchor", () => {
    expect(columnClickIntent(plain)).toBe("select");
    expect(columnClickIntent({ ...plain, anchorInColumn: true })).toBe("select");
  });

  it.each([{ metaKey: true }, { ctrlKey: true }, { metaKey: true, ctrlKey: true }])("toggles on %o", (mods) => {
    expect(columnClickIntent({ ...plain, ...mods })).toBe("toggle");
    expect(columnClickIntent({ ...plain, ...mods, anchorInColumn: true })).toBe("toggle");
  });

  it("extends a range from an anchor in the same column", () => {
    expect(columnClickIntent({ ...plain, shiftKey: true, anchorInColumn: true })).toBe("range");
  });

  it("treats shift-click as a plain click when the anchor is elsewhere", () => {
    expect(columnClickIntent({ ...plain, shiftKey: true, anchorInColumn: false })).toBe("select");
  });

  it("lets cmd/ctrl win over shift", () => {
    expect(columnClickIntent({ ...plain, metaKey: true, shiftKey: true, anchorInColumn: true })).toBe("toggle");
    expect(columnClickIntent({ ...plain, ctrlKey: true, shiftKey: true, anchorInColumn: true })).toBe("toggle");
  });

  it("ignores the click that ends a drag, whatever the modifiers", () => {
    const bools = [false, true];
    for (const metaKey of bools)
      for (const ctrlKey of bools)
        for (const shiftKey of bools)
          for (const anchorInColumn of bools) {
            const out: ColumnClickIntent = columnClickIntent({ metaKey, ctrlKey, shiftKey, anchorInColumn, suppressed: true });
            expect(out).toBe("ignore");
          }
  });

  it("never returns anything but the four intents", () => {
    const bools = [false, true];
    const seen = new Set<string>();
    for (const metaKey of bools)
      for (const ctrlKey of bools)
        for (const shiftKey of bools)
          for (const anchorInColumn of bools)
            for (const suppressed of bools)
              seen.add(columnClickIntent({ metaKey, ctrlKey, shiftKey, anchorInColumn, suppressed }));
    expect([...seen].sort()).toEqual(["ignore", "range", "select", "toggle"]);
  });
});
