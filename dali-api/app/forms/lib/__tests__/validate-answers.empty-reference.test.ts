import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/forms/lib/reference-sources", () => ({ resolveReferenceOptions: vi.fn() }));

import { validateAnswers } from "~/forms/lib/public-form";
import { resolveReferenceOptions } from "~/forms/lib/reference-sources";
import type { Question } from "~/types";

const project: Question = {
  key: "p",
  type: "reference",
  required: true,
  data: { label: "Project", referenceSource: "projects:my-organization" },
};

beforeEach(() => vi.resetAllMocks());

describe("a required Database list", () => {
  it("doesn't block when it has nothing to pick for this filler", async () => {
    vi.mocked(resolveReferenceOptions).mockResolvedValue([]);
    expect(await validateAnswers([project], {}, "u1")).toBeNull();
    expect(resolveReferenceOptions).toHaveBeenCalledWith("projects:my-organization", { userId: "u1", termId: undefined });
  });

  it("is still required when there is something to pick", async () => {
    vi.mocked(resolveReferenceOptions).mockResolvedValue([{ value: "proj1", label: "Alpha" }]);
    expect(await validateAnswers([project], {}, "u1")).toEqual({ error: '"Project" is required.', status: 400 });
  });

  it("re-resolves on the server rather than trusting an empty list from the client", async () => {
    vi.mocked(resolveReferenceOptions).mockResolvedValue([{ value: "proj1", label: "Alpha" }]);
    const claimed = { ...project, data: { ...project.data, referenceOptions: [] } };
    expect(await validateAnswers([claimed], {}, "u1")).toMatchObject({ status: 400 });
  });
});
