import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/s3", () => ({
  getDownloadUrl: vi.fn(),
}));

import { getDownloadUrl } from "~/lib/s3";
import { presignAnswers } from "~/hiring/lib/presign";
import type { Question } from "~/types";

const mockGetDownloadUrl = getDownloadUrl as unknown as ReturnType<typeof vi.fn>;

const fileQ: Question = {
  key: "resume",
  type: "file",
  required: false,
  data: { label: "Resume" },
};
const textQ: Question = {
  key: "name",
  type: "text",
  required: false,
  data: { label: "Name" },
};
const ghQ: Question = {
  key: "gh",
  type: "github_url",
  required: false,
  data: { label: "GH" },
};

beforeEach(() => {
  mockGetDownloadUrl.mockReset();
});

describe("presignAnswers", () => {
  it("replaces file-type S3 keys with presigned download URLs", async () => {
    mockGetDownloadUrl.mockResolvedValue("https://s3.example.com/signed-url");
    const result = await presignAnswers([fileQ], {
      resume: "applications/resume/abc-Resume.pdf",
    });
    expect(result.resume).toBe("https://s3.example.com/signed-url");
    expect(mockGetDownloadUrl).toHaveBeenCalledWith(
      "applications/resume/abc-Resume.pdf",
      900,
    );
  });

  it("leaves non-file question types untouched", async () => {
    const result = await presignAnswers([textQ, ghQ], {
      name: "Carol",
      gh: "https://github.com/carol/x",
    });
    expect(result).toEqual({
      name: "Carol",
      gh: "https://github.com/carol/x",
    });
    expect(mockGetDownloadUrl).not.toHaveBeenCalled();
  });

  it("does not presign empty/missing file answers", async () => {
    const result = await presignAnswers([fileQ], { resume: "   " });
    expect(result.resume).toBe("   ");
    const result2 = await presignAnswers([fileQ], {});
    expect(result2).toEqual({});
    expect(mockGetDownloadUrl).not.toHaveBeenCalled();
  });

  it("falls back to the raw key when presigning throws", async () => {
    mockGetDownloadUrl.mockRejectedValue(new Error("S3 down"));
    const result = await presignAnswers([fileQ], {
      resume: "applications/resume/abc-Resume.pdf",
    });
    expect(result.resume).toBe("applications/resume/abc-Resume.pdf");
  });

  it("preserves answers that have no matching question entry", async () => {
    mockGetDownloadUrl.mockResolvedValue("https://s3.example.com/signed-url");
    const result = await presignAnswers([fileQ], {
      resume: "applications/resume/abc-Resume.pdf",
      stray: "kept-as-is",
    });
    expect(result.stray).toBe("kept-as-is");
    expect(result.resume).toBe("https://s3.example.com/signed-url");
  });

  it("does not mutate the input answers object", async () => {
    mockGetDownloadUrl.mockResolvedValue("https://s3.example.com/signed-url");
    const input = { resume: "applications/resume/abc-Resume.pdf" };
    const result = await presignAnswers([fileQ], input);
    expect(input.resume).toBe("applications/resume/abc-Resume.pdf");
    expect(result.resume).toBe("https://s3.example.com/signed-url");
  });
});
