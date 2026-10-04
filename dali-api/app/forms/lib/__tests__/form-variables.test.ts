import { describe, it, expect } from "vitest";
import {
  ALL_FORM_VARIABLES,
  lintFormText,
  resolveFormVariables,
} from "~/forms/lib/form-variables";
import { extractPlaceholders, interpolateVars } from "~/lib/template-variables";

describe("form merge variables", () => {
  it("offers the shared term token, derived from the registry", () => {
    expect(ALL_FORM_VARIABLES).toEqual(["term"]);
  });

  it("resolves {{term}} in question text through the shared interpolator", () => {
    const vars = resolveFormVariables({ term: "27S" });
    expect(
      interpolateVars("Are you planning on being on a project in {{term}}?", vars),
    ).toBe("Are you planning on being on a project in 27S?");
  });

  it("leaves the token literal when no term resolves, rather than blanking it", () => {
    // An unbound form is a misconfiguration; showing the template beats
    // showing "a project in ?" to members.
    const vars = resolveFormVariables({ term: null });
    expect(vars).toEqual({});
    expect(interpolateVars("…in {{term}}?", vars)).toBe("…in {{term}}?");
  });

  it("flags a token this surface doesn't offer", () => {
    // A signing token pasted into a form: known to the registry, not offered
    // here, so it lints rather than silently resolving to nothing.
    expect(lintFormText("Signed by {{memberName}} for {{term}}").unknown).toEqual([
      "memberName",
    ]);
    expect(lintFormText("All good for {{term}}").unknown).toEqual([]);
  });
});

describe("term token binding awareness", () => {
  // What the builder's warning keys off: whether {{term}} is present at all.
  // Shared extractor, so the grammar can't drift from the interpolator's.
  it("detects the token the way the builder does", () => {
    expect(
      extractPlaceholders("Are you on a project in {{term}}?").includes("term"),
    ).toBe(true);
    expect(extractPlaceholders("No tokens here").includes("term")).toBe(false);
    // The no-whitespace grammar is deliberate: {{ term }} can't be
    // interpolated, so it must not read as a resolvable token either.
    expect(extractPlaceholders("in {{ term }}?").includes("term")).toBe(false);
  });
});
