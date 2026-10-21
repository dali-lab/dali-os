import { describe, expect, it } from "vitest";
import { parseCompletionRule } from "~/education/lib/completion-rule";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("parseCompletionRule", () => {
  it("percent mode sets the fraction and clears any session count", () => {
    expect(parseCompletionRule(form({ completionMode: "percent", completionAmount: "75" }))).toEqual({
      completionThreshold: 0.75,
      completionMinSessions: null,
    });
  });

  it("defaults to percent when the mode is missing", () => {
    expect(parseCompletionRule(form({ completionAmount: "80" }))).toEqual({
      completionThreshold: 0.8,
      completionMinSessions: null,
    });
  });

  it("clamps percent to 1..100", () => {
    expect(parseCompletionRule(form({ completionMode: "percent", completionAmount: "250" })).completionThreshold).toBe(1);
    expect(parseCompletionRule(form({ completionMode: "percent", completionAmount: "0.5" })).completionThreshold).toBe(0.01);
  });

  it("sessions mode sets the count and leaves the fraction alone", () => {
    expect(parseCompletionRule(form({ completionMode: "sessions", completionAmount: "4" }))).toEqual({
      completionMinSessions: 4,
    });
  });

  it("rounds a fractional session count", () => {
    expect(parseCompletionRule(form({ completionMode: "sessions", completionAmount: "3.6" }))).toEqual({
      completionMinSessions: 4,
    });
  });

  it.each(["", "0", "-2", "abc"])("ignores an invalid amount (%j)", (amount) => {
    expect(parseCompletionRule(form({ completionMode: "sessions", completionAmount: amount }))).toEqual({});
    expect(parseCompletionRule(form({ completionMode: "percent", completionAmount: amount }))).toEqual({});
  });

  it("ignores a form with no amount at all", () => {
    expect(parseCompletionRule(form({}))).toEqual({});
  });
});
