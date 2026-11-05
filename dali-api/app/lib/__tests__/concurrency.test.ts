import { describe, expect, it } from "vitest";
import { forEachWithLimit } from "~/lib/concurrency";

const tick = () => new Promise((r) => setTimeout(r, 1));

describe("forEachWithLimit", () => {
  it("visits every item once, never over the limit", async () => {
    let running = 0;
    let peak = 0;
    const seen: number[] = [];
    await forEachWithLimit([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      seen.push(item);
      running -= 1;
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
  });

  it("does nothing for no items", async () => {
    await expect(forEachWithLimit([], 3, async () => {})).resolves.toBeUndefined();
  });

  it("handles fewer items than the limit", async () => {
    const seen: string[] = [];
    await forEachWithLimit(["a"], 5, async (item) => {
      seen.push(item);
    });
    expect(seen).toEqual(["a"]);
  });

  it("rejects when an item fails", async () => {
    await expect(
      forEachWithLimit([1, 2], 2, async (item) => {
        if (item === 2) throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
