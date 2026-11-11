// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("~/lib/upload-client", () => ({ uploadFileToS3: vi.fn() }));

import { uploadFileToS3 } from "~/lib/upload-client";
import { FormQuestionField } from "~/components/form-builder/QuestionField";
import type { Question } from "~/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const upload = uploadFileToS3 as ReturnType<typeof vi.fn>;
const UPLOAD_URL = "/api/forms/fill/tok/upload";

let container: HTMLDivElement;
let root: Root;
let latest = "";

function fileQ(maxFiles?: number, exactFiles?: boolean): Question {
  return { key: "shots", type: "file", required: true, data: { label: "Shots", accept: "image/*", maxFiles, exactFiles } };
}

function Harness({ question, initial }: { question: Question; initial: string }) {
  const [value, setValue] = useState(initial);
  return createElement(FormQuestionField, {
    question,
    value,
    onChange: (v: string) => {
      latest = v;
      setValue(v);
    },
    uploadUrl: UPLOAD_URL,
  });
}

function render(question: Question, initial = "") {
  act(() => root.render(createElement(Harness, { question, initial })));
}

async function choose(...names: string[]) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const files = names.map((n) => new File(["x"], n, { type: "image/png" }));
  Object.defineProperty(input, "files", { value: files, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const text = () => container.textContent ?? "";
const keyFor = (name: string) => `uploads/applications/shots/0b6f8a52-1c1e-4d38-9a51-2f3c6d7e8f90-${name}`;

beforeEach(() => {
  latest = "";
  upload.mockReset();
  upload.mockImplementation(async (file: File) => ({ s3Key: keyFor(file.name) }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("file question field", () => {
  it("uploads through the given endpoint under the question's prefix and stores the key", async () => {
    render(fileQ());
    await choose("a.png");
    expect(upload).toHaveBeenCalledWith(expect.any(File), "applications/shots/", "image/*", UPLOAD_URL);
    expect(latest).toBe(keyFor("a.png"));
    expect(text()).toContain("a.png");
    expect(text()).not.toContain("Choose file to upload");
  });

  it("takes several files up to the limit and stores them as a JSON array", async () => {
    render(fileQ(3));
    expect(text()).toContain("Choose up to 3 files");
    expect(container.querySelector('input[type="file"]')!.hasAttribute("multiple")).toBe(true);
    await choose("a.png", "b.png");
    expect(JSON.parse(latest)).toEqual([keyFor("a.png"), keyFor("b.png")]);
    expect(text()).toContain("Add another file");
    await choose("c.png");
    expect(JSON.parse(latest)).toHaveLength(3);
    expect(text()).not.toContain("Add another file");
  });

  it("refuses picking more files than are left", async () => {
    render(fileQ(2), JSON.stringify([keyFor("a.png")]));
    await choose("b.png", "c.png");
    expect(upload).not.toHaveBeenCalled();
    expect(text()).toContain("You can add up to 2 files");
  });

  it("removes one file and keeps the rest", async () => {
    render(fileQ(3), JSON.stringify([keyFor("a.png"), keyFor("b.png")]));
    const remove = [...container.querySelectorAll("button")].find((b) => b.textContent === "Remove")!;
    act(() => remove.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(JSON.parse(latest)).toEqual([keyFor("b.png")]);
  });

  it("keeps files that uploaded before one failed and shows the error", async () => {
    upload
      .mockImplementationOnce(async (file: File) => ({ s3Key: keyFor(file.name) }))
      .mockRejectedValueOnce(new Error("File too large (max 50 MB)"));
    render(fileQ(3));
    await choose("a.png", "big.png");
    expect(JSON.parse(latest)).toEqual([keyFor("a.png")]);
    expect(text()).toContain("File too large (max 50 MB)");
  });

  it("counts down to an exact number of files", async () => {
    render(fileQ(3, true));
    expect(text()).toContain("Choose 3 files");
    await choose("a.png");
    expect(text()).toContain("Add 2 more files");
    await choose("b.png");
    expect(text()).toContain("Add 1 more file");
    await choose("c.png");
    expect(text()).not.toContain("more file");
  });

  it("says how many an exact question takes when too many are picked", async () => {
    render(fileQ(2, true));
    await choose("a.png", "b.png", "c.png");
    expect(upload).not.toHaveBeenCalled();
    expect(text()).toContain("This question takes exactly 2 files");
  });
});
