import { afterEach, describe, expect, it, vi } from "vitest";
import { logError } from "../log.server";

afterEach(() => vi.restoreAllMocks());

describe("logError", () => {
  it("writes one line with scope, message, stack and context", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("boom");
    logError("jobs.thing", err, { id: "a1", n: 2, ok: true, none: null });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("[jobs.thing] boom", {
      id: "a1",
      n: 2,
      ok: true,
      none: null,
      stack: err.stack,
    });
  });

  it("stringifies a non-Error value and omits the stack", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("x", "plain failure");
    expect(spy).toHaveBeenCalledWith("[x] plain failure", {});
  });
});
