import { describe, expect, it, vi } from "vitest";
import { importMarkdownFile, MARKDOWN_IMPORT_ACCEPT, skippedMessage } from "~/lib/markdown-import-client";

function setup(response: { ok?: boolean; json?: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: response.ok ?? true, json: async () => response.json });
  const insert = vi.fn();
  const toast = { success: vi.fn(), error: vi.fn() };
  const run = (file = new File(["# Hi"], "a.md")) =>
    importMarkdownFile("p1", file, { fetch: fetchMock as never, insert, toast });
  return { fetchMock, insert, toast, run };
}

describe("importMarkdownFile", () => {
  it("posts the file and appends the returned blocks without a toast when nothing was skipped", async () => {
    const { fetchMock, insert, toast, run } = setup({ json: { blocks: [{ type: "paragraph" }], skipped: 0 } });
    const file = new File(["# Hi"], "a.md");
    await run(file);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/documents/p1/import");
    expect(init.method).toBe("POST");
    expect((init.body as FormData).get("file")).toBe(file);
    expect(insert).toHaveBeenCalledWith([{ type: "paragraph" }]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says how many images were kept as links", async () => {
    const { insert, toast, run } = setup({ json: { blocks: [{}], skipped: 2 } });
    await run();
    expect(insert).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Imported. 2 images couldn't be added and were kept as links.");
  });

  it("shows the server's message and inserts nothing when the import fails", async () => {
    const { insert, toast, run } = setup({ ok: false, json: { error: "This .zip has no Markdown file." } });
    await run();
    expect(insert).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("This .zip has no Markdown file.");
  });

  it("falls back to a general message when the response has no details", async () => {
    const { toast, run } = setup({ ok: false, json: undefined });
    await run();
    expect(toast.error).toHaveBeenCalledWith("Couldn't import that file.");
  });
});

describe("import copy", () => {
  it("uses the singular for one image", () => {
    expect(skippedMessage(1)).toBe("Imported. 1 image couldn't be added and was kept as a link.");
  });

  it("accepts zip files in the picker", () => {
    expect(MARKDOWN_IMPORT_ACCEPT).toContain(".zip");
    expect(MARKDOWN_IMPORT_ACCEPT).toContain("application/zip");
  });
});
