import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/db.server");

import { validateAnswers } from "~/forms/lib/public-form";
import type { Question } from "~/types";

function q(
  key: string,
  type: Question["type"],
  data: Partial<Question["data"]> = {},
  required = false,
): Question {
  return { key, type, required, data: { label: key, ...data } };
}
const when = (questionKey: string, op: "is" | "isNot" | "includes" | "excludes", value: string) => ({
  showIf: { questionKey, op, value },
});
const run = (questions: Question[], answers: Record<string, unknown>, stored?: Record<string, unknown>) =>
  validateAnswers(questions, answers, "user-1", stored);

const returning = q("returning", "select", { options: ["Yes", "No"] }, true);

describe("validateAnswers with rules", () => {
  it("does not require a hidden question", async () => {
    const form = [returning, q("why", "textarea", when("returning", "is", "No"), true)];
    expect(await run(form, { returning: "Yes" })).toBeNull();
  });

  it("requires a question once its rule shows it", async () => {
    const form = [returning, q("why", "textarea", when("returning", "is", "No"), true)];
    expect(await run(form, { returning: "No" })).toEqual({ error: '"why" is required.', status: 400 });
  });

  it("removes a posted hidden answer from the answers object", async () => {
    const form = [returning, q("why", "textarea", when("returning", "is", "No"))];
    const answers: Record<string, unknown> = { returning: "Yes", why: "stale text" };
    expect(await run(form, answers)).toBeNull();
    expect(answers).toEqual({ returning: "Yes" });
  });

  it("keeps a shown answer", async () => {
    const form = [returning, q("why", "textarea", when("returning", "is", "No"))];
    const answers: Record<string, unknown> = { returning: "No", why: "moving" };
    expect(await run(form, answers)).toBeNull();
    expect(answers).toEqual({ returning: "No", why: "moving" });
  });

  it("does not let a hidden question's bad value fail a format check", async () => {
    const form = [
      returning,
      q("mail", "email", when("returning", "is", "No")),
      q("rating", "scale", when("returning", "is", "No")),
      q("boxes", "checkbox", { options: ["A"], ...when("returning", "is", "No") }),
    ];
    const answers: Record<string, unknown> = {
      returning: "Yes",
      mail: "not an email",
      rating: "9",
      boxes: "{garbage",
    };
    expect(await run(form, answers)).toBeNull();
    expect(answers).toEqual({ returning: "Yes" });
  });

  it("still checks the format of a shown question", async () => {
    const form = [returning, q("mail", "email", when("returning", "is", "No"))];
    expect(await run(form, { returning: "No", mail: "nope" })).toMatchObject({ status: 400 });
  });

  it("does not block on a hidden required file", async () => {
    const form = [returning, q("resume", "file", when("returning", "is", "No"), true)];
    expect(await run(form, { returning: "Yes" })).toBeNull();
  });

  it("requires a shown required file", async () => {
    const form = [returning, q("resume", "file", when("returning", "is", "No"), true)];
    expect(await run(form, { returning: "No" })).toMatchObject({
      status: 400,
      error: '"resume" is required.',
    });
  });

  it("hides a whole chain", async () => {
    const form = [
      returning,
      q("kind", "select", { options: ["X"], ...when("returning", "is", "No") }),
      q("detail", "text", when("kind", "is", "X"), true),
    ];
    const answers: Record<string, unknown> = { returning: "Yes", kind: "X", detail: "deep" };
    expect(await run(form, answers)).toBeNull();
    expect(answers).toEqual({ returning: "Yes" });
  });

  it("reads checkbox sources in both shapes", async () => {
    const box = q("domains", "checkbox", { options: ["Design", "Eng"] });
    const form = [box, q("portfolio", "text", when("domains", "includes", "Design"), true)];
    for (const domains of [["Design"], JSON.stringify(["Design"])]) {
      expect(await run(form, { domains })).toEqual({ error: '"portfolio" is required.', status: 400 });
    }
    expect(await run(form, { domains: ["Eng"] })).toBeNull();
  });

  it("does not resolve the options of a hidden reference question", async () => {
    const form = [returning, q("proj", "reference", { referenceSource: "nope", ...when("returning", "is", "No") })];
    expect(await run(form, { returning: "Yes", proj: "anything" })).toBeNull();
  });

  it("behaves exactly as before on a form with no rules", async () => {
    const form = [returning, q("why", "textarea", {}, true)];
    const answers: Record<string, unknown> = { returning: "Yes", why: "kept", extra: "x" };
    expect(await run(form, answers)).toBeNull();
    expect(answers).toEqual({ returning: "Yes", why: "kept", extra: "x" });
    expect(await run(form, { returning: "Yes" })).toEqual({ error: '"why" is required.', status: 400 });
  });
});
