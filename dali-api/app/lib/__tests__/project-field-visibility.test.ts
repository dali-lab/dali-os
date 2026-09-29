import { describe, it, expect } from "vitest";
import {
  redactCoreOnlyProjectFields,
  CORE_ONLY_PROJECT_FIELDS,
} from "~/lib/project-field-visibility";

// The list is empty today, so the mechanism is exercised with an explicit one.
const GATED = ["internalNote"];

const project = {
  id: "p1",
  name: "Link VT",
  internalNote: "renewal pending",
  deploymentUrl: "https://example.org",
};

describe("redactCoreOnlyProjectFields", () => {
  it("passes everything through for Core", () => {
    expect(redactCoreOnlyProjectFields(project, true, GATED)).toEqual(project);
  });

  it("nulls the Core-only fields for everyone else", () => {
    const out = redactCoreOnlyProjectFields(project, false, GATED);
    expect(out.internalNote).toBeNull();
  });

  it("keeps every other field intact", () => {
    const out = redactCoreOnlyProjectFields(project, false, GATED);
    expect(out.id).toBe("p1");
    expect(out.name).toBe("Link VT");
    expect(out.deploymentUrl).toBe("https://example.org");
  });

  it("keeps the key present so the payload shape doesn't depend on the viewer", () => {
    // React Router infers the client type from the loader's return, so a
    // conditionally-absent key would change the type per viewer.
    const out = redactCoreOnlyProjectFields(project, false, GATED);
    expect(Object.keys(out).sort()).toEqual(Object.keys(project).sort());
  });

  it("does not mutate the input", () => {
    const input = { ...project };
    redactCoreOnlyProjectFields(input, false, GATED);
    expect(input.internalNote).toBe("renewal pending");
  });

  it("tolerates an object that lacks the gated fields", () => {
    const partial = { id: "p2", name: "Deserto" };
    expect(redactCoreOnlyProjectFields(partial, false, GATED)).toEqual(partial);
  });

  it("gates nothing by default now that chart strings have their own table", () => {
    expect(CORE_ONLY_PROJECT_FIELDS).toEqual([]);
    expect(redactCoreOnlyProjectFields(project, false)).toEqual(project);
  });
});
