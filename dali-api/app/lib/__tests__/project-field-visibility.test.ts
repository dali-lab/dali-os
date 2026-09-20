import { describe, it, expect } from "vitest";
import {
  redactCoreOnlyProjectFields,
  CORE_ONLY_PROJECT_FIELDS,
} from "~/lib/project-field-visibility";

const project = {
  id: "p1",
  name: "Link VT",
  chartString: "521765.5000.B04373.XXXXX.330",
  chartStringType: "PTAEO",
  deploymentUrl: "https://example.org",
};

describe("redactCoreOnlyProjectFields", () => {
  it("passes everything through for Core", () => {
    expect(redactCoreOnlyProjectFields(project, true)).toEqual(project);
  });

  it("nulls the Core-only fields for everyone else", () => {
    const out = redactCoreOnlyProjectFields(project, false);
    expect(out.chartString).toBeNull();
    expect(out.chartStringType).toBeNull();
  });

  it("keeps every other field intact", () => {
    const out = redactCoreOnlyProjectFields(project, false);
    expect(out.id).toBe("p1");
    expect(out.name).toBe("Link VT");
    expect(out.deploymentUrl).toBe("https://example.org");
  });

  it("keeps the key present so the payload shape doesn't depend on the viewer", () => {
    // React Router infers the client type from the loader's return, so a
    // conditionally-absent key would change the type per viewer.
    const out = redactCoreOnlyProjectFields(project, false);
    expect(Object.keys(out).sort()).toEqual(Object.keys(project).sort());
  });

  it("does not mutate the input", () => {
    const input = { ...project };
    redactCoreOnlyProjectFields(input, false);
    expect(input.chartString).toBe("521765.5000.B04373.XXXXX.330");
  });

  it("tolerates an object that lacks the gated fields", () => {
    const partial = { id: "p2", name: "Deserto" };
    expect(redactCoreOnlyProjectFields(partial, false)).toEqual(partial);
  });

  it("gates chart strings", () => {
    expect([...CORE_ONLY_PROJECT_FIELDS]).toContain("chartString");
    expect([...CORE_ONLY_PROJECT_FIELDS]).toContain("chartStringType");
  });
});
