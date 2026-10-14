import { describe, expect, it } from "vitest";
import { runPool } from "./run-pool";

describe("runPool", () => {
  it("never exceeds the limit and visits every item once", async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      seen.push(n);
      inFlight -= 1;
    });
    expect(peak).toBe(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("uses no more lanes than items", async () => {
    let peak = 0;
    let inFlight = 0;
    await runPool([1, 2], 5, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight -= 1;
    });
    expect(peak).toBe(2);
  });

  it("resolves immediately for an empty list", async () => {
    await expect(runPool([], 3, async () => {})).resolves.toBeUndefined();
  });
});
