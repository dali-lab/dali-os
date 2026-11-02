import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/db.server");

import { validateAnswers } from "~/forms/lib/public-form";
import type { Question } from "~/types";

function q(
  type: Question["type"],
  data: Partial<Question["data"]> = {},
  required = false,
  key = "k",
): Question {
  return { key, type, required, data: { label: "Pick", ...data } };
}

const run = (questions: Question[], answers: Record<string, unknown>) =>
  validateAnswers(questions, answers, "user-1");

describe("validateAnswers formats", () => {
  it("rejects a bad email, date, number and scale with a 400 naming the question", async () => {
    for (const [type, value] of [
      ["email", "nope"],
      ["date", "2026-02-30"],
      ["number", "abc"],
      ["scale", "7"],
    ] as const) {
      const result = await run([q(type)], { k: value });
      expect(result).toMatchObject({ status: 400 });
      expect(result?.error).toContain('"Pick"');
    }
  });

  it("normalizes email in place", async () => {
    const answers: Record<string, unknown> = { k: "  Ada@Example.EDU " };
    expect(await run([q("email")], answers)).toBeNull();
    expect(answers.k).toBe("ada@example.edu");
  });

  it("enforces number bounds", async () => {
    expect(await run([q("number", { min: 1, max: 3 })], { k: "4" })).toMatchObject({ status: 400 });
    expect(await run([q("number", { min: 1, max: 3 })], { k: "2" })).toBeNull();
  });

  it("requires a required answer of each new type", async () => {
    for (const type of ["radio", "scale", "date", "number", "email"] as const) {
      const result = await run([q(type, { options: ["a", "b"] }, true)], { k: "" });
      expect(result?.error).toContain("required");
    }
  });

  it("lets an optional blank through", async () => {
    for (const type of ["radio", "scale", "date", "number", "email"] as const) {
      expect(await run([q(type, { options: ["a", "b"] })], { k: "" })).toBeNull();
    }
  });

  it("still does not validate select against its options", async () => {
    expect(await run([q("select", { options: ["a"] })], { k: "z" })).toBeNull();
  });

  describe("radio", () => {
    const radio = (extra: Partial<Question["data"]> = {}) => q("radio", { options: ["Red", "Blue"], ...extra });

    it("accepts a listed option", async () => {
      expect(await run([radio()], { k: "Red" })).toBeNull();
    });
    it("rejects an unlisted value without allowOther", async () => {
      expect(await run([radio()], { k: "Green" })).toMatchObject({ status: 400 });
    });
    it("stores Other text literally with allowOther", async () => {
      const answers: Record<string, unknown> = { k: " Green  " };
      expect(await run([radio({ allowOther: true })], answers)).toBeNull();
      expect(answers.k).toBe(" Green  ");
    });
    it("caps Other text at 200 characters", async () => {
      expect(await run([radio({ allowOther: true })], { k: "x".repeat(200) })).toBeNull();
      const over = await run([radio({ allowOther: true })], { k: "x".repeat(201) });
      expect(over).toMatchObject({ status: 400 });
      expect(over?.error).toContain("200");
    });
  });

  describe("checkbox allowOther", () => {
    const box = (extra: Partial<Question["data"]> = {}) => q("checkbox", { options: ["A", "B"], ...extra });

    it("accepts one Other text alongside options and stores a real array", async () => {
      const answers: Record<string, unknown> = { k: JSON.stringify(["A", "Something else"]) };
      expect(await run([box({ allowOther: true })], answers)).toBeNull();
      expect(answers.k).toEqual(["A", "Something else"]);
    });
    it("accepts Other alone", async () => {
      expect(await run([box({ allowOther: true })], { k: '["Mine"]' })).toBeNull();
    });
    it("rejects Other text when allowOther is off", async () => {
      const result = await run([box()], { k: '["A","Mine"]' });
      expect(result).toMatchObject({ status: 400 });
      expect(result?.error).toContain("no longer available");
    });
    it("rejects more than one Other value", async () => {
      expect(await run([box({ allowOther: true })], { k: '["x","y"]' })).toMatchObject({ status: 400 });
    });
    it("caps Other text at 200 characters", async () => {
      expect(await run([box({ allowOther: true })], { k: JSON.stringify(["x".repeat(200)]) })).toBeNull();
      const over = await run([box({ allowOther: true })], { k: JSON.stringify(["x".repeat(201)]) });
      expect(over).toMatchObject({ status: 400 });
      expect(over?.error).toContain("200");
    });
    it("rejects a blank Other value", async () => {
      expect(await run([box({ allowOther: true })], { k: '["  "]' })).toMatchObject({ status: 400 });
    });
  });
});
