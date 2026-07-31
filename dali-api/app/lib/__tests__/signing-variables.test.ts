import { describe, it, expect } from "vitest";
import {
  extractSigningPlaceholders,
  lintSigningText,
  resolveSigningVariables,
  isKnownSigningVariable,
} from "../signing-variables";

describe("signing variables", () => {
  it("extracts {{tokens}} in order", () => {
    expect(extractSigningPlaceholders("Hi {{memberName}}, welcome for {{term}}.")).toEqual([
      "memberName",
      "term",
    ]);
  });

  it("lints unknown tokens only", () => {
    expect(lintSigningText("{{term}} {{bogus}} {{today}}")).toEqual({ unknown: ["bogus"] });
    expect(lintSigningText("{{term}}")).toEqual({ unknown: [] });
  });

  it("knows the registered variable set", () => {
    expect(isKnownSigningVariable("term")).toBe(true);
    expect(isKnownSigningVariable("nope")).toBe(false);
  });

  it("resolves provided inputs and defaults the rest to empty", () => {
    expect(resolveSigningVariables({ term: "26S", memberName: "Ada Lovelace" })).toEqual({
      term: "26S",
      today: "",
      memberName: "Ada Lovelace",
      supervisorName: "",
    });
  });
});
