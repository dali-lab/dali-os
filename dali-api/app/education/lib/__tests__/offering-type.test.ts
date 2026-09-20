import { describe, it, expect } from "vitest";
import { isMultiSession, isOfferingType } from "../offering-type";

describe("offering types", () => {
  it("treats miniseries and fellowships as multi-session, workshops as single", () => {
    expect(isMultiSession("Miniseries")).toBe(true);
    expect(isMultiSession("Fellowship")).toBe(true);
    expect(isMultiSession("Workshop")).toBe(false);
  });

  it("accepts only known types from form input", () => {
    expect(isOfferingType("Fellowship")).toBe(true);
    expect(isOfferingType("fellowship")).toBe(false);
    expect(isOfferingType(null)).toBe(false);
  });
});
