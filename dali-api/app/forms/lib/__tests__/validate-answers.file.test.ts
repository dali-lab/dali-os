import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/db.server");

import { validateAnswers } from "~/forms/lib/public-form";
import type { Question } from "~/types";

const KEY_A = "uploads/applications/shots/0b6f8a52-1c1e-4d38-9a51-2f3c6d7e8f90-a.png";
const KEY_B = "uploads/applications/shots/7d1e2f3a-4b5c-4d6e-8f70-112233445566-b.png";
const KEY_C = "uploads/applications/shots/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d-c.png";

function fileQ(data: Partial<Question["data"]> = {}, required = true): Question {
  return { key: "shots", type: "file", required, data: { label: "Screenshots", ...data } };
}

describe.each([
  ["signed in", "user-1"],
  ["anonymous", null],
] as const)("validateAnswers file questions (%s)", (_, userId) => {
  const run = (q: Question, answers: Record<string, unknown>, stored?: Record<string, unknown>) =>
    validateAnswers([q], answers, userId, stored);

  it("accepts a required file and stores the key", async () => {
    const answers: Record<string, unknown> = { shots: KEY_A };
    expect(await run(fileQ(), answers)).toBeNull();
    expect(answers.shots).toBe(KEY_A);
  });

  it("stores a multi-file answer as an array, deduped", async () => {
    const answers: Record<string, unknown> = { shots: JSON.stringify([KEY_A, KEY_B, KEY_A]) };
    expect(await run(fileQ({ maxFiles: 3 }), answers)).toBeNull();
    expect(answers.shots).toEqual([KEY_A, KEY_B]);
  });

  it("rejects more files than the question takes", async () => {
    expect(await run(fileQ(), { shots: JSON.stringify([KEY_A, KEY_B]) })).toEqual({
      error: '"Screenshots": takes one file.',
      status: 400,
    });
    expect(await run(fileQ({ maxFiles: 2 }), { shots: [KEY_A, KEY_B, KEY_C] })).toEqual({
      error: '"Screenshots": takes up to 2 files.',
      status: 400,
    });
  });

  it("needs exactly N files when the question says exactly", async () => {
    const exact = fileQ({ maxFiles: 3, exactFiles: true });
    expect(await run(exact, { shots: [KEY_A, KEY_B] })).toEqual({
      error: '"Screenshots": add exactly 3 files.',
      status: 400,
    });
    const answers: Record<string, unknown> = { shots: [KEY_A, KEY_B, KEY_C] };
    expect(await run(exact, answers)).toBeNull();
    expect(answers.shots).toEqual([KEY_A, KEY_B, KEY_C]);
  });

  it("requires at least one file for a required up-to question", async () => {
    expect(await run(fileQ({ maxFiles: 3 }), { shots: "[]" })).toMatchObject({ status: 400 });
    expect(await run(fileQ({ maxFiles: 3 }), { shots: [KEY_A] })).toBeNull();
  });

  it("lets an optional exactly question be left empty", async () => {
    expect(await run(fileQ({ maxFiles: 3, exactFiles: true }, false), { shots: "" })).toBeNull();
  });

  it("rejects a key that wasn't uploaded for this question", async () => {
    for (const key of [
      "uploads/applications/cv/0b6f8a52-a.pdf",
      "uploads/avatars/someone.png",
      "uploads/applications/shots/../../resumes/a.pdf",
    ]) {
      expect(await run(fileQ(), { shots: key })).toMatchObject({ status: 400 });
    }
  });

  it("requires a required file", async () => {
    for (const shots of [undefined, "", "[]"]) {
      expect(await run(fileQ(), { shots })).toEqual({
        error: '"Screenshots" is required.',
        status: 400,
      });
    }
  });

  it("drops an empty optional file answer", async () => {
    const answers: Record<string, unknown> = { shots: "[]" };
    expect(await run(fileQ({}, false), answers)).toBeNull();
    expect(answers).not.toHaveProperty("shots");
  });

  it("keeps a stored file key on an edit even if it predates the question prefix", async () => {
    const legacy = "uploads/files/cv.pdf";
    const answers: Record<string, unknown> = { shots: JSON.stringify([legacy, KEY_B]) };
    expect(await run(fileQ({ maxFiles: 3 }), answers, { shots: [legacy] })).toBeNull();
    expect(answers.shots).toEqual([legacy, KEY_B]);
  });

  it("leaves an unchanged stored answer as it is", async () => {
    const stored = { shots: { key: "files/cv.pdf" } };
    const answers: Record<string, unknown> = { ...stored };
    expect(await run(fileQ(), answers, stored)).toBeNull();
    expect(answers.shots).toEqual({ key: "files/cv.pdf" });
  });
});
