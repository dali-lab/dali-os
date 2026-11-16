import { beforeEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";

vi.mock("~/lib/s3.server", () => ({ putObject: vi.fn() }));

import { ImportError, IMPORT_ZIP_BYTES, importLimitFor, importMarkdownFile, readImportFile } from "~/lib/markdown-import.server";

const SMALL = { unzippedBytes: 5_000, files: 4 };
import { MAX_UPLOAD_BYTES } from "~/lib/file-validation";

const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const text = (s: string) => strToU8(s);
const zip = (files: Record<string, Uint8Array | string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? text(v) : v])));
const rejection = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error as ImportError;
  }
  throw new Error("did not throw");
};

describe("readImportFile", () => {
  it("reads plain text files as UTF-8 and drops a byte order mark", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...text("# Hi é")]);
    expect(readImportFile("notes.MD", bytes)).toEqual({ markdown: "# Hi é", baseDir: "" });
    expect(readImportFile("a.txt", text("x")).markdown).toBe("x");
    expect(readImportFile("a.markdown", text("x")).markdown).toBe("x");
  });

  it("rejects other file types", () => {
    expect(rejection(() => readImportFile("a.pdf", text("x"))).status).toBe(400);
  });

  it("reads the Markdown file and the other entries from a zip", () => {
    const source = readImportFile("Plan.zip", zip({ "Plan.md": "![a](Plan/a.png)", "Plan/a.png": PNG }));
    expect(source.markdown).toBe("![a](Plan/a.png)");
    expect(source.baseDir).toBe("");
    expect([...source.files!.keys()]).toEqual(["Plan/a.png"]);
  });

  it("uses the Markdown file's folder as the base when it is nested", () => {
    const source = readImportFile("x.zip", zip({ "export/doc.md": "hi", "export/img/a.png": PNG }));
    expect(source.baseDir).toBe("export");
    expect(source.files!.has("export/img/a.png")).toBe(true);
  });

  it("prefers the Markdown file at the shallowest depth", () => {
    const source = readImportFile("x.zip", zip({ "doc.md": "top", "notes/other.md": "deep" }));
    expect(source.markdown).toBe("top");
  });

  it("rejects a zip with no Markdown file", () => {
    const error = rejection(() => readImportFile("x.zip", zip({ "a.png": PNG })));
    expect([error.status, error.message]).toEqual([400, "This .zip has no Markdown file."]);
  });

  it("rejects a zip with two Markdown files at the same depth", () => {
    const error = rejection(() => readImportFile("x.zip", zip({ "a.md": "1", "b.md": "2" })));
    expect(error.status).toBe(400);
    expect(error.message).toContain("more than one Markdown file");
  });

  it("ignores __MACOSX and dotfiles", () => {
    const source = readImportFile(
      "x.zip",
      zip({ "doc.md": "hi", "__MACOSX/._doc.md": "junk", ".DS_Store": PNG, "img/.hidden.png": PNG, "img/a.png": PNG }),
    );
    expect([...source.files!.keys()]).toEqual(["img/a.png"]);
  });

  it("rejects a zip with more entries than allowed", () => {
    const files = Object.fromEntries(Array.from({ length: 5 }, (_, n) => [`f${n}.md`, "x"]));
    const error = rejection(() => readImportFile("x.zip", zip(files), SMALL));
    expect(error.status).toBe(413);
  });

  it("rejects a zip that unpacks past the size limit from its headers", () => {
    const error = rejection(() => readImportFile("x.zip", zip({ "doc.md": "x", "big.png": new Uint8Array(6_000) }), SMALL));
    expect(error.status).toBe(413);
  });

  it("reports an unreadable zip", () => {
    expect(rejection(() => readImportFile("x.zip", text("not a zip"))).status).toBe(400);
  });
});

describe("importLimitFor", () => {
  it("allows a zip more than a text file", () => {
    expect(importLimitFor("a.md")).toBe(MAX_UPLOAD_BYTES);
    expect(importLimitFor("a.ZIP")).toBe(IMPORT_ZIP_BYTES);
  });
});

describe("importMarkdownFile", () => {
  const putObject = vi.fn();
  const fetchMock = vi.fn();
  const deps = { putObject, fetch: fetchMock, resolveHost: async () => ["93.184.216.34"] };

  beforeEach(() => {
    vi.resetAllMocks();
    putObject.mockResolvedValue(undefined);
  });

  it("turns a zip's relative images into uploaded image blocks", async () => {
    const bytes = zip({ "Plan.md": "# Plan\n\n![chart](Plan/chart.png)\n", "Plan/chart.png": PNG });
    const { blocks, skipped } = await importMarkdownFile({ fileName: "Plan.zip", bytes, pageId: "p1", deps });
    expect(skipped).toBe(0);
    expect(blocks.map((b) => b.type)).toEqual(["heading", "image"]);
    expect(blocks[1]!.props.url).toMatch(/^\/api\/upload\/raw\?key=uploads%2Fdoc-images%2Fp1%2F[0-9a-f-]{36}-chart\.png$/);
    expect(putObject).toHaveBeenCalledWith(expect.stringMatching(/^uploads\/doc-images\/p1\//), PNG, "image/png");
  });

  it("restores an uploaded video from a zip as a video block", async () => {
    const bytes = zip({ "doc.md": "![demo](clips/demo.mp4)\n", "clips/demo.mp4": PNG });
    const { blocks } = await importMarkdownFile({ fileName: "doc.zip", bytes, pageId: "p1", deps });
    expect(blocks.map((b) => b.type)).toEqual(["video"]);
  });

  it("reports how many images were kept as links", async () => {
    fetchMock.mockResolvedValue(new Response("gone", { status: 404 }));
    const { blocks, skipped } = await importMarkdownFile({
      fileName: "a.md",
      bytes: text("![a](https://cdn.example.com/a.png)\n\n![b](./missing.png)\n"),
      pageId: "p1",
      deps,
    });
    expect(skipped).toBe(2);
    expect(blocks.map((b) => b.type)).toEqual(["paragraph"]);
  });

  it("moves an inline image into its own block", async () => {
    const { blocks } = await importMarkdownFile({
      fileName: "a.md",
      bytes: text("See ![q](/api/upload/raw?key=uploads/q.png) here.\n"),
      pageId: "p1",
      deps,
    });
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "image"]);
  });
});
