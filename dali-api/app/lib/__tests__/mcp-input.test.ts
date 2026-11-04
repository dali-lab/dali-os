import { describe, it, expect } from "vitest";
import { validateInput, type JsonSchema } from "~/lib/mcp-input";

describe("validateInput", () => {
  it("accepts an empty object when no required fields", () => {
    const r = validateInput(undefined, {
      type: "object",
      properties: {},
      additionalProperties: false,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects unexpected properties when additionalProperties is false", () => {
    const r = validateInput(
      { foo: 1 },
      { type: "object", properties: {}, additionalProperties: false },
    );
    expect(r.ok).toBe(false);
  });

  it("enforces integer minimum/maximum", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { n: { type: "integer", minimum: 1, maximum: 5 } },
      additionalProperties: false,
    };
    expect(validateInput({ n: 0 }, schema).ok).toBe(false);
    expect(validateInput({ n: 6 }, schema).ok).toBe(false);
    expect(validateInput({ n: 3 }, schema).ok).toBe(true);
  });

  it("enforces required fields", () => {
    const r = validateInput(
      {},
      { type: "object", required: ["x"], properties: { x: { type: "string" } } },
    );
    expect(r.ok).toBe(false);
  });

  it("enforces array maxItems and item type", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, maxItems: 2 },
      },
    };
    expect(validateInput({ ids: ["a", "b", "c"] }, schema).ok).toBe(false);
    expect(validateInput({ ids: ["a", 1] }, schema).ok).toBe(false);
    expect(validateInput({ ids: ["a"] }, schema).ok).toBe(true);
  });

  it("enforces enum", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { mode: { type: "integer", enum: [15, 30, 45, 60] } },
    };
    expect(validateInput({ mode: 7 }, schema).ok).toBe(false);
    expect(validateInput({ mode: 30 }, schema).ok).toBe(true);
  });

  it("enforces string length bounds", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { q: { type: "string", minLength: 1, maxLength: 5 } },
    };
    expect(validateInput({ q: "" }, schema).ok).toBe(false);
    expect(validateInput({ q: "abcdef" }, schema).ok).toBe(false);
    expect(validateInput({ q: "abc" }, schema).ok).toBe(true);
  });

  it("accepts any type in a type list and names them all when none match", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { projectId: { type: ["string", "null"] } },
      required: ["projectId"],
      additionalProperties: false,
    };
    expect(validateInput({ projectId: "p1" }, schema).ok).toBe(true);
    expect(validateInput({ projectId: null }, schema).ok).toBe(true);
    expect(validateInput({ projectId: 3 }, schema)).toEqual({
      ok: false,
      error: "projectId: expected string or null, got integer",
    });
  });

  it("keeps the single-type error message", () => {
    const schema: JsonSchema = { type: "object", properties: { n: { type: "integer" } } };
    expect(validateInput({ n: "x" }, schema)).toEqual({
      ok: false,
      error: "n: expected integer, got string",
    });
  });
});
