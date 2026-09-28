import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { uploadFileToS3 } from "~/lib/upload-client";

const MB = 1024 * 1024;

/** A File that reports `bytes` without allocating them — size is all the
 *  pre-check reads, and the network is mocked. */
function fileOfSize(bytes: number, name = "deck.pdf", type = "application/pdf"): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: bytes });
  return file;
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function presignThen(upload: Response) {
  fetchMock
    .mockResolvedValueOnce(
      Response.json({ url: "https://bucket.s3.amazonaws.com/", fields: { key: "k" }, key: "uploads/k" }),
    )
    .mockResolvedValueOnce(upload);
}

describe("uploadFileToS3 size pre-check", () => {
  it("gives a Lab Documents version 100 MB though its prefix has no trailing slash", async () => {
    // documents.file.$fileId.tsx passes "lab-files", not "lab-files/".
    presignThen(new Response(null, { status: 204 }));
    const meta = await uploadFileToS3(fileOfSize(50 * MB), "lab-files");

    expect(meta.sizeBytes).toBe(50 * MB);
    const presignBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(presignBody.key).toMatch(/^lab-files\/[0-9a-f-]{36}-deck\.pdf$/);
  });

  it("refuses a 101 MB project file before asking for a URL", async () => {
    await expect(uploadFileToS3(fileOfSize(101 * MB), "project-files/p1")).rejects.toThrow(
      "File too large (max 100 MB)",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps everything outside the file store at 10 MB", async () => {
    await expect(uploadFileToS3(fileOfSize(11 * MB, "me.png", "image/png"), "avatars")).rejects.toThrow(
      "File too large (max 10 MB)",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("names S3's EntityTooLarge as too large whatever the status", async () => {
    presignThen(
      new Response("<Error><Code>EntityTooLarge</Code></Error>", { status: 400 }),
    );
    await expect(uploadFileToS3(fileOfSize(20 * MB), "project-files/p1")).rejects.toThrow(
      "File too large (max 100 MB)",
    );
  });
});
