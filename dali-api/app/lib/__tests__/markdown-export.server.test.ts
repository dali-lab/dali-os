import { beforeEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";

vi.mock("~/lib/s3.server", () => ({
  headObject: vi.fn(),
  getObjectStream: vi.fn(),
  putObjectStream: vi.fn(),
  deleteObject: vi.fn(),
  getDownloadUrl: vi.fn(),
  putObject: vi.fn(),
}));

import { exportMarkdown } from "~/lib/markdown-export.server";
import { importMarkdownFile } from "~/lib/markdown-import.server";
import { MAX_ZIP_FILES } from "~/drive/lib/drive-download.server";
import { deleteObject, getDownloadUrl, getObjectStream, headObject, putObjectStream } from "~/lib/s3.server";
import type { DocBlock } from "~/collab/blocknote-server";

const BASE = { backgroundColor: "default", textColor: "default", textAlignment: "left" };
const block = (type: string, props: Record<string, unknown> = {}, children: DocBlock[] = []): DocBlock =>
  ({ id: crypto.randomUUID(), type, props: { ...BASE, ...props }, children, content: type === "paragraph" ? [{ type: "text", text: "Hello", styles: {} }] : undefined }) as unknown as DocBlock;
const raw = (key: string) => `/api/upload/raw?key=${encodeURIComponent(key)}`;
const media = (type: string, key: string, props: Record<string, unknown> = {}) =>
  block(type, { url: raw(key), name: key.split("/").pop(), ...props });

const ORIGIN = "https://dali.example";
let stored: Uint8Array | null;
const objects: Record<string, string> = {};

function exportDoc(blocks: DocBlock[], title = "Plan") {
  return exportMarkdown({ title, fileName: title.replace(/\s+/g, "_"), blocks, origin: ORIGIN });
}

function zipEntries() {
  return Object.fromEntries(Object.entries(unzipSync(stored!)).map(([name, data]) => [name, strFromU8(data)]));
}

beforeEach(() => {
  vi.resetAllMocks();
  stored = null;
  for (const key of Object.keys(objects)) delete objects[key];
  vi.mocked(headObject).mockImplementation(async (key) => (key in objects ? { sizeBytes: objects[key]!.length, contentType: null } : null));
  vi.mocked(getObjectStream).mockImplementation(async (key) =>
    key in objects ? (async function* () { yield new TextEncoder().encode(objects[key]!); })() : null,
  );
  vi.mocked(putObjectStream).mockImplementation(async (_key, chunks) => {
    const parts: Uint8Array[] = [];
    for await (const chunk of chunks) parts.push(chunk);
    stored = new Uint8Array(Buffer.concat(parts));
  });
  vi.mocked(getDownloadUrl).mockResolvedValue("https://signed.example/doc.zip");
});

describe("exportMarkdown", () => {
  it("stays a plain markdown file when the document has no uploads", async () => {
    const result = await exportDoc([block("paragraph"), block("image", { url: "https://ex.com/a.png", name: "a" })]);
    expect(result).toEqual({ kind: "markdown", markdown: "# Plan\n\nHello\n\n![a](https://ex.com/a.png)\n" });
    expect(putObjectStream).not.toHaveBeenCalled();
  });

  it("zips the markdown with relative links and the stored bytes", async () => {
    objects["uploads/doc-images/p1/1111aaaa-2222-3333-4444-555566667777-chart.png"] = "PNGDATA";
    objects["uploads/files/clip.mp4"] = "MP4DATA";
    const result = await exportDoc([
      media("image", "uploads/doc-images/p1/1111aaaa-2222-3333-4444-555566667777-chart.png"),
      media("video", "uploads/files/clip.mp4"),
    ]);
    expect(result).toEqual({ kind: "zip", url: "https://signed.example/doc.zip" });
    expect(getDownloadUrl).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ fileName: "Plan.zip" }));
    const entries = zipEntries();
    expect(Object.keys(entries).sort()).toEqual(["Plan.md", "Plan/chart.png", "Plan/clip.mp4"]);
    expect(entries["Plan/chart.png"]).toBe("PNGDATA");
    expect(entries["Plan/clip.mp4"]).toBe("MP4DATA");
    expect(entries["Plan.md"]).toBe(
      "# Plan\n\n![1111aaaa-2222-3333-4444-555566667777-chart.png](Plan/chart.png)\n\n![clip.mp4](Plan/clip.mp4)\n",
    );
  });

  it("encodes a title with spaces in the relative links", async () => {
    objects["uploads/a/pic.png"] = "x";
    await exportDoc([media("image", "uploads/a/pic.png")], "My plan");
    expect(zipEntries()["My_plan.md"]).toContain("![pic.png](My_plan/pic.png)");
  });

  it("gives files with the same name unique names", async () => {
    objects["uploads/a/pic.png"] = "one";
    objects["uploads/b/pic.png"] = "two";
    await exportDoc([media("image", "uploads/a/pic.png"), media("image", "uploads/b/pic.png")]);
    const entries = zipEntries();
    expect(entries["Plan/pic.png"]).toBe("one");
    expect(entries["Plan/pic (1).png"]).toBe("two");
    expect(entries["Plan.md"]).toContain("Plan/pic%20(1).png");
  });

  it("writes one entry for an upload used twice and finds uploads inside nested blocks", async () => {
    objects["uploads/a/pic.png"] = "one";
    await exportDoc([block("paragraph", {}, [media("image", "uploads/a/pic.png")]), media("image", "uploads/a/pic.png")]);
    expect(Object.keys(zipEntries()).sort()).toEqual(["Plan.md", "Plan/pic.png"]);
    expect(zipEntries()["Plan.md"].match(/Plan\/pic\.png/g)).toHaveLength(2);
  });

  it("keeps the absolute DALI link for a key missing from storage", async () => {
    objects["uploads/a/pic.png"] = "one";
    await exportDoc([media("image", "uploads/a/pic.png"), media("image", "uploads/a/gone.png")]);
    const entries = zipEntries();
    expect(Object.keys(entries).sort()).toEqual(["Plan.md", "Plan/pic.png"]);
    expect(entries["Plan.md"]).toContain(`![gone.png](${ORIGIN}/api/upload/raw?key=uploads%2Fa%2Fgone.png)`);
  });

  it("returns markdown with absolute links when nothing can be zipped", async () => {
    const result = await exportDoc([media("image", "uploads/a/gone.png")]);
    expect(result).toEqual({
      kind: "markdown",
      markdown: `# Plan\n\n![gone.png](${ORIGIN}/api/upload/raw?key=uploads%2Fa%2Fgone.png)\n`,
    });
    expect(putObjectStream).not.toHaveBeenCalled();
  });

  it("never zips a reserved key and leaves its link alone", async () => {
    objects["uploads/resumes/cv.pdf"] = "secret";
    const result = await exportDoc([block("file", { url: raw("uploads/resumes/cv.pdf"), name: "cv.pdf" })]);
    expect(result.kind).toBe("markdown");
    expect(headObject).not.toHaveBeenCalled();
    expect(getObjectStream).not.toHaveBeenCalled();
  });

  it("keeps the remaining media as absolute links past the file cap", async () => {
    const keys = Array.from({ length: MAX_ZIP_FILES + 2 }, (_, n) => `uploads/a/f${n}.png`);
    for (const key of keys) objects[key] = "x";
    await exportDoc(keys.map((key) => media("image", key)));
    const entries = zipEntries();
    expect(Object.keys(entries)).toHaveLength(MAX_ZIP_FILES);
    expect(entries["Plan.md"]).toContain("Plan/f0.png");
    expect(entries["Plan.md"]).toContain(`${ORIGIN}/api/upload/raw?key=uploads%2Fa%2Ff${MAX_ZIP_FILES + 1}.png`);
  });

  it("keeps media past the byte cap as absolute links", async () => {
    objects["uploads/a/small.png"] = "x";
    vi.mocked(headObject).mockImplementation(async (key) => ({ sizeBytes: key.endsWith("huge.png") ? 600 * 1024 * 1024 : 1, contentType: null }));
    await exportDoc([media("image", "uploads/a/huge.png"), media("image", "uploads/a/small.png")]);
    const md = zipEntries()["Plan.md"];
    expect(md).toContain(`${ORIGIN}/api/upload/raw?key=uploads%2Fa%2Fhuge.png`);
    expect(md).toContain("Plan/small.png");
  });

  it("falls back to absolute links when storage is not reachable", async () => {
    vi.mocked(headObject).mockRejectedValue(new Error("AWS S3 is not configured"));
    const result = await exportDoc([media("image", "uploads/a/pic.png")]);
    expect(result.kind).toBe("markdown");
  });

  it("deletes nothing and returns markdown if the archive ends up empty", async () => {
    vi.mocked(deleteObject).mockResolvedValue(undefined);
    objects["uploads/a/pic.png"] = "x";
    vi.mocked(getObjectStream).mockResolvedValue(null);
    const result = await exportDoc([media("image", "uploads/a/pic.png")]);
    expect(result.kind).toBe("zip");
  });
});

describe("export then import", () => {
  it("brings images and videos back into a new document", async () => {
    objects["uploads/doc-images/p1/chart.png"] = "PNGDATA";
    objects["uploads/doc-images/p1/demo.mp4"] = "MP4DATA";
    await exportDoc([
      block("paragraph"),
      media("image", "uploads/doc-images/p1/chart.png", { previewWidth: 300 }),
      media("video", "uploads/doc-images/p1/demo.mp4"),
    ]);
    const putObject = vi.fn().mockResolvedValue(undefined);
    const { blocks, skipped } = await importMarkdownFile({
      fileName: "Plan.zip",
      bytes: stored!,
      pageId: "p2",
      deps: { putObject, fetch: vi.fn(), resolveHost: async () => ["93.184.216.34"] },
    });
    expect(skipped).toBe(0);
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "image", "video"]);
    expect(blocks[2]!.props).toMatchObject({ previewWidth: 300 });
    expect(blocks[2]!.props.url).toContain("uploads%2Fdoc-images%2Fp2%2F");
    expect(blocks[2]!.props.url).toContain("chart.png");
    expect(blocks[3]!.props.url).toContain("demo.mp4");
    expect(putObject).toHaveBeenCalledTimes(2);
    expect(Buffer.from(putObject.mock.calls[0]![1]).toString()).toBe("PNGDATA");
  });
});
