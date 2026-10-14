import { describe, expect, it, vi } from "vitest";
import { MAX_CONCURRENT_UPLOADS, summarizeFailures, uploadAll } from "./upload-batch";

const file = (name: string) => new File(["x"], name);
const files = (n: number) => Array.from({ length: n }, (_, i) => file(`f${i + 1}.txt`));

describe("uploadAll", () => {
  it("keeps at most MAX_CONCURRENT_UPLOADS in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    await uploadAll(files(9), async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight -= 1;
    });
    expect(MAX_CONCURRENT_UPLOADS).toBe(3);
    expect(peak).toBe(3);
  });

  it("continues past failures and returns them with their messages", async () => {
    const seen: string[] = [];
    const failed = await uploadAll(files(4), async (f) => {
      seen.push(f.name);
      if (f.name === "f2.txt") throw new Error("Too big");
      if (f.name === "f3.txt") throw "nope";
    });
    expect(seen.sort()).toEqual(["f1.txt", "f2.txt", "f3.txt", "f4.txt"]);
    expect(failed).toEqual([
      { name: "f2.txt", error: "Too big" },
      { name: "f3.txt", error: "Upload failed" },
    ]);
  });

  it("reports progress after every file with a snapshot of the failures", async () => {
    const onSettled = vi.fn();
    await uploadAll(files(2), async (f) => {
      if (f.name === "f1.txt") throw new Error("x");
    }, onSettled);
    expect(onSettled).toHaveBeenCalledTimes(2);
    expect(onSettled.mock.calls[0][0]).toMatchObject({ done: 1, total: 2 });
    expect(onSettled.mock.calls[1][0]).toEqual({ done: 2, total: 2, failed: [{ name: "f1.txt", error: "x" }] });
  });
});

describe("summarizeFailures", () => {
  it("is null when nothing failed", () => {
    expect(summarizeFailures([], 3)).toBeNull();
  });

  it("lists the failed names for a batch", () => {
    expect(summarizeFailures([{ name: "a.pdf", error: "x" }, { name: "b.png", error: "y" }], 5)).toBe(
      "2 of 5 files failed: a.pdf, b.png",
    );
  });

  it("truncates a long list", () => {
    const failed = ["a", "b", "c", "d", "e"].map((name) => ({ name, error: "x" }));
    expect(summarizeFailures(failed, 5)).toBe("5 of 5 files failed: a, b, c and 2 more");
  });

  it("uses the file's own error for a one-file batch", () => {
    expect(summarizeFailures([{ name: "a.pdf", error: "Too big" }], 1)).toBe("Too big");
  });
});
