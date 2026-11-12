// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readStorage, writeStorage } from "../safe-storage";

const original = Object.getOwnPropertyDescriptor(window, "localStorage");

afterEach(() => {
  if (original) Object.defineProperty(window, "localStorage", original);
});

function blockStorage() {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("denied", "SecurityError");
    },
  });
}

describe("safe-storage", () => {
  it("round trips a value and removes it on null", () => {
    writeStorage("k", "v");
    expect(readStorage("k")).toBe("v");
    writeStorage("k", null);
    expect(readStorage("k")).toBeNull();
  });

  it("returns null for a missing key", () => {
    expect(readStorage("missing")).toBeNull();
  });

  it("reads null and writes nothing when storage access throws", () => {
    blockStorage();
    expect(readStorage("k")).toBeNull();
    expect(() => writeStorage("k", "v")).not.toThrow();
    expect(() => writeStorage("k", null)).not.toThrow();
  });
});
