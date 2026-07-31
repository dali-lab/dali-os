import { describe, it, expect } from "vitest";
import {
  bakeSigningBody,
  collectSigningFields,
  fieldDisplayText,
  variableDisplayText,
  isCheckboxChecked,
} from "../signing-fields";

const body = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Welcome back for the " },
        { type: "variable", attrs: { name: "term" } },
        { type: "text", text: " term." },
      ],
    },
    {
      type: "paragraph",
      content: [
        { type: "signatureField", attrs: { fieldId: "sig1", role: "member", required: true } },
        { type: "dateField", attrs: { fieldId: "date1", role: "member", required: true } },
        { type: "checkboxField", attrs: { fieldId: "ack1", role: "member", required: false } },
        { type: "signatureField", attrs: { fieldId: "sup1", role: "supervisor", required: true } },
      ],
    },
  ],
};

describe("collectSigningFields", () => {
  it("collects every field with its role + required flag", () => {
    const fields = collectSigningFields(body);
    expect(fields).toEqual([
      { fieldId: "sig1", type: "signatureField", role: "member", required: true },
      { fieldId: "date1", type: "dateField", role: "member", required: true },
      { fieldId: "ack1", type: "checkboxField", role: "member", required: false },
      { fieldId: "sup1", type: "signatureField", role: "supervisor", required: true },
    ]);
  });

  it("returns [] for a non-object body", () => {
    expect(collectSigningFields(null)).toEqual([]);
    expect(collectSigningFields("nope")).toEqual([]);
  });
});

describe("bakeSigningBody", () => {
  it("bakes captured field values + resolved variables into attrs.value, immutably", () => {
    const baked = bakeSigningBody(body, {
      fieldValues: { sig1: "Ada Lovelace", date1: "July 30, 2026", ack1: true },
      variables: { term: "26S" },
    }) as typeof body;

    // variable resolved
    expect(baked.content[0].content![1].attrs).toMatchObject({ name: "term", value: "26S" });
    // member fields baked
    expect(baked.content[1].content![0].attrs).toMatchObject({ value: "Ada Lovelace" });
    expect(baked.content[1].content![1].attrs).toMatchObject({ value: "July 30, 2026" });
    expect(baked.content[1].content![2].attrs).toMatchObject({ value: true });
    // supervisor field left untouched (no value provided)
    expect(baked.content[1].content![3].attrs).not.toHaveProperty("value");
    // input not mutated
    expect(body.content[1].content![0].attrs).not.toHaveProperty("value");
  });
});

describe("fieldDisplayText / variableDisplayText / isCheckboxChecked", () => {
  it("renders checkbox glyphs and passthrough text", () => {
    expect(fieldDisplayText("checkboxField", true)).toBe("☑");
    expect(fieldDisplayText("checkboxField", false)).toBe("☐");
    expect(fieldDisplayText("signatureField", "Ada")).toBe("Ada");
    expect(fieldDisplayText("textField", null)).toBe("");
  });

  it("shows the token for an unresolved variable, else the value", () => {
    expect(variableDisplayText("term", "")).toBe("{{term}}");
    expect(variableDisplayText("term", "26S")).toBe("26S");
  });

  it("treats true and 'true' as checked", () => {
    expect(isCheckboxChecked(true)).toBe(true);
    expect(isCheckboxChecked("true")).toBe(true);
    expect(isCheckboxChecked(false)).toBe(false);
    expect(isCheckboxChecked(undefined)).toBe(false);
  });
});
