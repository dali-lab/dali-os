// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("./worklet-processor.js?url", () => ({ default: "worklet.js" }));

describe("live-session on the server", () => {
  it("imports and answers without touching window", async () => {
    expect(typeof window).toBe("undefined");
    const mod = await import("./live-session");
    expect(mod.getLiveSession()).toBeNull();
    await expect(mod.refreshLiveSession()).resolves.toBeUndefined();
    expect(() => mod.clearLiveSession("x")).not.toThrow();
  });
});
