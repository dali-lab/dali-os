import { describe, it, expect } from "vitest";
import {
  extractPlaceholders,
  interpolateVars,
  findUnknownPlaceholders,
  variablesForContext,
  TEMPLATE_VARIABLES_REGISTRY,
} from "../template-variables";

describe("extractPlaceholders", () => {
  it("returns each {{token}} in order and ignores whitespace variants", () => {
    expect(extractPlaceholders("Hi {{firstName}} — {{ spaced }} {{term}}")).toEqual([
      "firstName",
      "term",
    ]);
  });
});

describe("interpolateVars", () => {
  it("replaces known tokens and leaves unknown ones as literal text", () => {
    expect(interpolateVars("Hi {{firstName}}, {{bogus}}", { firstName: "Ada" })).toBe(
      "Hi Ada, {{bogus}}",
    );
  });

  it("substitutes empty string for a present-but-blank var", () => {
    expect(interpolateVars("[{{domain}}]", { domain: "" })).toBe("[]");
  });

  it("does not treat $-sequences in values as regex backrefs", () => {
    expect(interpolateVars("{{x}}", { x: "$& $1 $$" })).toBe("$& $1 $$");
  });
});

describe("variablesForContext", () => {
  it("partitions the registry by context", () => {
    expect(variablesForContext("email")).toContain("firstName");
    expect(variablesForContext("email")).not.toContain("term");
    expect(variablesForContext("signing")).toContain("term");
    expect(variablesForContext("signing")).not.toContain("firstName");
  });

  it("covers every registry entry across the two contexts", () => {
    const all = new Set([...variablesForContext("email"), ...variablesForContext("signing")]);
    expect(all.size).toBe(Object.keys(TEMPLATE_VARIABLES_REGISTRY).length);
  });
});

describe("findUnknownPlaceholders", () => {
  it("returns only tokens not in the known set, de-duplicated", () => {
    expect(findUnknownPlaceholders("{{a}} {{b}} {{a}}", ["a"])).toEqual(["b"]);
  });
});
