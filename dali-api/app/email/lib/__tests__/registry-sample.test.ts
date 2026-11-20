import { describe, expect, it } from "vitest";
import { emailTemplateDef, sampleWith } from "~/email/lib/registry";

const KEY = "hiring:decision:Waitlisted" as const;

describe("sampleWith", () => {
  it("returns the registry sample when there are no overrides", () => {
    expect(sampleWith(KEY, null)).toEqual(emailTemplateDef(KEY).sample);
    expect(sampleWith(KEY, "not an object")).toEqual(emailTemplateDef(KEY).sample);
  });

  it("replaces a variable the email uses", () => {
    expect(sampleWith(KEY, { respondBy: "Friday, January 8, 2027" }).respondBy).toBe("Friday, January 8, 2027");
  });

  it("keeps the rest of the sample", () => {
    const out = sampleWith(KEY, { respondBy: "Friday, January 8, 2027" });
    expect(out.firstName).toBe(emailTemplateDef(KEY).sample.firstName);
  });

  it("ignores variables the email doesn't use, non-strings and overlong values", () => {
    const out = sampleWith(KEY, { tempPassword: "x", firstName: 3, domain: "d".repeat(201) });
    expect(out).toEqual(emailTemplateDef(KEY).sample);
  });
});
