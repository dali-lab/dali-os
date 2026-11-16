import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FETCH_TIMEOUT_MS,
  rewriteMarkdownImages,
  zipPath,
  type ImageOptions,
} from "~/lib/markdown-images.server";
import { MAX_UPLOAD_BYTES } from "~/lib/file-validation";

vi.mock("~/lib/s3.server", () => ({ putObject: vi.fn() }));

const putObject = vi.fn();
const fetchMock = vi.fn();
const PUBLIC = async () => ["93.184.216.34"];
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const UPLOADED = /\/api\/upload\/raw\?key=uploads%2Fdoc-images%2Fp1%2F[0-9a-f-]{36}-/;

function run(markdown: string, extra: Partial<ImageOptions> = {}) {
  const { deps, ...rest } = extra;
  return rewriteMarkdownImages(markdown, {
    uploadPrefix: "uploads/doc-images/p1/",
    maxImages: 50,
    deps: { fetch: fetchMock, putObject, resolveHost: PUBLIC, ...deps },
    ...rest,
  });
}

const image = (body: Uint8Array | string = PNG, type = "image/png", init: ResponseInit = {}) =>
  new Response(body as BodyInit, { status: 200, headers: { "content-type": type }, ...init });

beforeEach(() => {
  vi.resetAllMocks();
  putObject.mockResolvedValue(undefined);
});

describe("images that stay as they are", () => {
  it("returns text without images untouched and does no work", async () => {
    const md = "# Title\n\nSome `![not](an-image)` text.\n\n```\n![code](https://ex.com/a.png)\n```\n";
    expect(await run(md)).toEqual({ markdown: md, skipped: 0, notes: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves an image inside a code block and inline code alone", async () => {
    const md = "```\n![a](https://ex.com/a.png)\n```\n\nUse `![b](https://ex.com/b.png)` here.\n";
    expect((await run(md)).markdown).toBe(md);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps an uploaded DALI image byte for byte", async () => {
    const md = "Intro\n\n![chart](/api/upload/raw?key=uploads/doc-images/p1/abc-chart.png)\n\nOutro\n";
    expect(await run(md)).toEqual({ markdown: md, skipped: 0, notes: [] });
  });

  it("turns an absolute link to this site's upload into a relative one", async () => {
    const result = await run("![a](https://dali.example/api/upload/raw?key=uploads%2Fx%2Fa.png)", {
      ownOrigin: "https://dali.example",
    });
    expect(result.markdown).toBe("![a](/api/upload/raw?key=uploads%2Fx%2Fa.png)");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a reserved upload key", async () => {
    const result = await run("![a](/api/upload/raw?key=uploads/resumes/a.pdf)");
    expect(result.skipped).toBe(1);
    expect(result.markdown).not.toContain("resumes");
  });

  it("keeps a hosted video as a link without fetching it", async () => {
    const md = "![Demo](https://www.youtube.com/watch?v=OY8fr2E96lg)\n";
    expect(await run(md)).toEqual({ markdown: md, skipped: 0, notes: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("moving images out of text", () => {
  it("hoists an inline image after its paragraph and keeps the text", async () => {
    const result = await run("Before ![q3](/api/upload/raw?key=uploads/a.png) after.\n\nNext.\n");
    expect(result.markdown).toBe("Before  after.\n\n![q3](/api/upload/raw?key=uploads/a.png)\n\nNext.\n");
    expect(result.notes).toEqual(['Image "q3" was inside a paragraph and was moved to its own block after it']);
  });

  it("hoists a table cell image after the table", async () => {
    const md = "| A | B |\n| - | - |\n| x | ![pic](/api/upload/raw?key=uploads/a.png) |\n\nAfter\n";
    const result = await run(md);
    expect(result.markdown).toBe(
      "| A | B |\n| - | - |\n| x |  |\n\n![pic](/api/upload/raw?key=uploads/a.png)\n\nAfter\n",
    );
    expect(result.notes[0]).toContain("inside a table cell and was moved to its own block after the table");
  });

  it("keeps the order of several images from one paragraph", async () => {
    const result = await run(
      "One ![a](/api/upload/raw?key=uploads/a.png) two ![b](/api/upload/raw?key=uploads/b.png) three\n",
    );
    expect(result.markdown).toBe(
      "One  two  three\n\n![a](/api/upload/raw?key=uploads/a.png)\n\n![b](/api/upload/raw?key=uploads/b.png)\n",
    );
  });

  it("unwraps a linked image and keeps the image", async () => {
    const result = await run("[![badge](/api/upload/raw?key=uploads/b.png)](https://ex.com/page)\n");
    expect(result.markdown).toBe("![badge](/api/upload/raw?key=uploads/b.png)\n");
  });

  it("leaves a link that holds text next to an image as a link", async () => {
    const result = await run("[see ![b](/api/upload/raw?key=uploads/b.png) here](https://ex.com/p)\n");
    expect(result.markdown).toBe("[see  here](https://ex.com/p)\n\n![b](/api/upload/raw?key=uploads/b.png)\n");
  });

  it("resolves a reference-style image and drops its definition", async () => {
    const md = "Text\n\n![chart][image1]\n\nMore\n\n[image1]: /api/upload/raw?key=uploads/a.png\n";
    const result = await run(md);
    expect(result.markdown).toBe("Text\n\n![chart](/api/upload/raw?key=uploads/a.png)\n\nMore\n\n");
  });

  it("keeps a definition that a text link also uses", async () => {
    const md = "![a][r] and [site][r]\n\n[r]: https://ex.com/x.png\n";
    fetchMock.mockResolvedValue(image());
    const result = await run(md);
    expect(result.markdown).toContain("[r]: https://ex.com/x.png");
  });

  it("writes Google Docs style base64 references as uploaded images", async () => {
    const b64 = Buffer.from(PNG).toString("base64");
    const result = await run(`![][image1]\n\n[image1]: <data:image/png;base64,${b64}>\n`);
    expect(putObject).toHaveBeenCalledWith(expect.stringMatching(/image\.png$/), expect.any(Buffer), "image/png");
    expect(result.markdown).toMatch(new RegExp(`^!\\[\\]\\(${UPLOADED.source}image\\.png\\)\\n\\n$`));
    expect(result.markdown).not.toContain("base64");
  });
});

describe("resolving each image", () => {
  it("uploads a data image", async () => {
    const result = await run(`![dot](data:image/png;base64,${Buffer.from(PNG).toString("base64")})`);
    const [key, bytes, type] = putObject.mock.calls[0]!;
    expect(key).toMatch(/^uploads\/doc-images\/p1\/[0-9a-f-]{36}-image\.png$/);
    expect(Buffer.from(bytes)).toEqual(Buffer.from(PNG));
    expect(type).toBe("image/png");
    expect(result.markdown).toMatch(UPLOADED);
    expect(result.notes).toEqual(['Image "dot" was copied into DALI']);
  });

  it("refuses a data link that is not a base64 image", async () => {
    const result = await run("![x](data:text/html;base64,PGI+)");
    expect(putObject).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.markdown).toBe("");
  });

  it("finds a relative path in the zip and uploads it", async () => {
    const files = new Map([["Plan/chart one.png", PNG]]);
    const result = await run("![c](Plan/chart%20one.png)", { files, baseDir: "" });
    expect(putObject).toHaveBeenCalledWith(expect.stringMatching(/chart_one\.png$/), PNG, "image/png");
    expect(result.markdown).toMatch(UPLOADED);
    expect(result.skipped).toBe(0);
  });

  it("looks up a relative path from the Markdown file's folder", async () => {
    const files = new Map([["doc/img/a.png", PNG]]);
    await run("![a](./img/a.png)", { files, baseDir: "doc" });
    expect(putObject).toHaveBeenCalledTimes(1);
  });

  it("does not resolve a path that climbs above the zip root", async () => {
    const files = new Map([["secret.png", PNG]]);
    const result = await run("![a](../secret.png)", { files, baseDir: "" });
    expect(putObject).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it("drops a relative path when there is no zip to read it from", async () => {
    const result = await run("![a](./a.png)");
    expect(result.skipped).toBe(1);
    expect(result.markdown).toBe("");
  });

  it("refuses a file in the zip that is not an image", async () => {
    const files = new Map([["notes.pdf", PNG]]);
    const result = await run("![a](notes.pdf)", { files });
    expect(putObject).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it("fetches an external image and uploads it", async () => {
    fetchMock.mockResolvedValue(image());
    const result = await run("![chart](https://cdn.example.com/img/chart.png?v=2)\n");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cdn.example.com/img/chart.png?v=2",
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(putObject).toHaveBeenCalledWith(expect.stringMatching(/-chart\.png$/), expect.any(Uint8Array), "image/png");
    expect(result.markdown).toMatch(UPLOADED);
    expect(result.skipped).toBe(0);
  });

  it("fetches a plain http image", async () => {
    fetchMock.mockResolvedValue(image());
    const result = await run("![a](http://cdn.example.com/a.png)");
    expect(fetchMock).toHaveBeenCalledWith("http://cdn.example.com/a.png", expect.anything());
    expect(result.markdown).toMatch(UPLOADED);
  });

  it("names a fetched image from its content type when the link has no extension", async () => {
    fetchMock.mockResolvedValue(image(PNG, "image/jpeg"));
    await run("![a](https://cdn.example.com/photo)");
    expect(putObject).toHaveBeenCalledWith(expect.stringMatching(/-photo\.jpg$/), expect.anything(), "image/jpeg");
  });

  it("refuses a host that resolves to a private address", async () => {
    const result = await run("![a](https://internal.example.com/a.png)", {
      deps: { resolveHost: async () => ["10.0.0.5"] } as never,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.markdown).toBe("[a](https://internal.example.com/a.png)");
    expect(result.skipped).toBe(1);
    expect(result.notes[0]).toContain("the address is not allowed");
  });

  it("refuses a private address written as an IP, over http too", async () => {
    await run("![a](http://169.254.169.254/latest/meta-data)\n\n![b](https://127.0.0.1/a.png)");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a redirect to a private address", async () => {
    const resolveHost = vi.fn(async (host: string) => (host === "evil.example.com" ? ["10.0.0.5"] : ["93.184.216.34"]));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://evil.example.com/a.png" } }));
    const result = await run("![a](https://cdn.example.com/a.png)", { deps: { resolveHost } as never });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.skipped).toBe(1);
    expect(putObject).not.toHaveBeenCalled();
  });

  it("follows a redirect to another public host", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "/final/a.png" } }))
      .mockResolvedValueOnce(image());
    const result = await run("![a](https://cdn.example.com/a.png)");
    expect(fetchMock).toHaveBeenLastCalledWith("https://cdn.example.com/final/a.png", expect.anything());
    expect(result.skipped).toBe(0);
  });

  it("stops after three redirects", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 302, headers: { location: "/again" } }));
    const result = await run("![a](https://cdn.example.com/a.png)");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.skipped).toBe(1);
  });

  it("writes a link for a response that is not an image", async () => {
    fetchMock.mockResolvedValue(image("<html>", "text/html"));
    const result = await run("![a](https://cdn.example.com/page)");
    expect(result.markdown).toBe("[a](https://cdn.example.com/page)");
    expect(putObject).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it("accepts a video response only when the name says video", async () => {
    fetchMock.mockResolvedValueOnce(image(PNG, "video/mp4")).mockResolvedValueOnce(image(PNG, "video/mp4"));
    const result = await run("![clip](https://cdn.example.com/clip.mp4)\n\n![clip](https://cdn.example.com/clip)");
    expect(putObject).toHaveBeenCalledTimes(1);
    expect(result.skipped).toBe(1);
  });

  it("refuses an image whose declared size is over the limit", async () => {
    fetchMock.mockResolvedValue(image(PNG, "image/png", { headers: { "content-type": "image/png", "content-length": String(MAX_UPLOAD_BYTES + 1) } }));
    const result = await run("![a](https://cdn.example.com/a.png)");
    expect(putObject).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it("stops reading a body that grows past the limit", async () => {
    fetchMock.mockResolvedValue(image(new Uint8Array(MAX_UPLOAD_BYTES + 1)));
    const result = await run("![a](https://cdn.example.com/a.png)");
    expect(putObject).not.toHaveBeenCalled();
    expect(result.markdown).toBe("[a](https://cdn.example.com/a.png)");
  });

  it("falls back to a link when the request times out", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted")))),
    );
    const result = await run("![a](https://cdn.example.com/a.png)", { deps: { timeoutMs: 5 } as never });
    expect(result.markdown).toBe("[a](https://cdn.example.com/a.png)");
    expect(result.notes[0]).toContain("it timed out");
    expect(FETCH_TIMEOUT_MS).toBe(10_000);
  });

  it("writes a link when the server answers with an error", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 404 }));
    const result = await run("![chart](https://cdn.example.com/a.png)");
    expect(result.markdown).toBe("[chart](https://cdn.example.com/a.png)");
    expect(result.notes).toEqual(['Image "chart" could not be fetched (HTTP 404) and was written as a link']);
  });

  it("names the link after the file when the image has no description", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    expect((await run("![](https://cdn.example.com/dir/a%20b.png)")).markdown).toBe("[a b.png](https://cdn.example.com/dir/a%20b.png)");
  });

  it("writes a link when the file cannot be stored", async () => {
    fetchMock.mockResolvedValue(image());
    putObject.mockRejectedValue(new Error("down"));
    const result = await run("![a](https://cdn.example.com/a.png)");
    expect(result.markdown).toBe("[a](https://cdn.example.com/a.png)");
    expect(result.skipped).toBe(1);
  });

  it.each(["javascript:alert(1)", "file:///etc/passwd", "ftp://ex.com/a.png", "vbscript:x"])(
    "drops %s to nothing and counts it",
    async (url) => {
      const result = await run(`Text\n\n![a](${url})\n`);
      expect(result.markdown).toBe("Text\n\n\n");
      expect(result.skipped).toBe(1);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("counts images past the limit as skipped and keeps their links", async () => {
    fetchMock.mockImplementation(async () => image());
    const md = [1, 2, 3, 4].map((n) => `![i${n}](https://cdn.example.com/${n}.png)`).join("\n\n");
    const result = await run(md, { maxImages: 2 });
    expect(putObject).toHaveBeenCalledTimes(2);
    expect(result.skipped).toBe(2);
    expect(result.markdown).toContain("[i3](https://cdn.example.com/3.png)");
    expect(result.markdown).toContain("[i4](https://cdn.example.com/4.png)");
  });

  it("does not count images already in DALI or hosted videos against the limit", async () => {
    fetchMock.mockImplementation(async () => image());
    const md = [
      "![a](/api/upload/raw?key=uploads/a.png)",
      "![v](https://youtu.be/OY8fr2E96lg)",
      "![b](https://cdn.example.com/b.png)",
    ].join("\n\n");
    const result = await run(md, { maxImages: 1 });
    expect(result.skipped).toBe(0);
  });

  it("runs at most four fetches at once", async () => {
    let active = 0;
    let peak = 0;
    fetchMock.mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return image();
    });
    const md = Array.from({ length: 10 }, (_, n) => `![i](https://cdn.example.com/${n}.png)`).join("\n\n");
    await run(md);
    expect(peak).toBe(4);
  });

  it("writes a description with brackets so the image still parses", async () => {
    const result = await run("![a \\] b](/api/upload/raw?key=uploads/a.png)\n\ntext ![x [y]](/api/upload/raw?key=uploads/b.png)");
    expect(result.markdown).toContain("![a ) b](/api/upload/raw?key=uploads/a.png)");
  });
});

describe("img tags", () => {
  const files = new Map([["Plan/a.png", PNG]]);

  it("uploads a resized image from a zip and keeps its width", async () => {
    const result = await run('<img src="Plan/a.png" alt="chart" width="300">\n', { files });
    expect(result.markdown).toMatch(/^<img src="\/api\/upload\/raw\?key=uploads%2Fdoc-images%2Fp1%2F[0-9a-f-]{36}-a\.png" alt="chart" width="300">\n$/);
  });

  it("uploads the image inside a figure with a caption", async () => {
    const result = await run('<figure><img alt="chart" src="Plan/a.png"><figcaption>Cap</figcaption></figure>\n', { files });
    expect(result.markdown).toMatch(/^<figure><img src="[^"]*uploads%2Fdoc-images%2Fp1[^"]*" alt="chart"><figcaption>Cap<\/figcaption><\/figure>\n$/);
    expect(result.skipped).toBe(0);
  });

  it("leaves a figure image that is already in DALI as written", async () => {
    const md = '<figure><img alt="c" src="/api/upload/raw?key=uploads/a.png"><figcaption>Cap</figcaption></figure>\n';
    expect((await run(md)).markdown).toBe(md);
  });

  it("keeps a figure image's own web link when it cannot be fetched", async () => {
    fetchMock.mockResolvedValue(new Response("no", { status: 404 }));
    const md = '<figure><img alt="c" src="https://cdn.example.com/a.png"><figcaption>Cap</figcaption></figure>\n';
    const result = await run(md);
    expect(result.markdown).toBe(md);
    expect(result.skipped).toBe(1);
  });

  it("decodes entities in the link before fetching", async () => {
    fetchMock.mockResolvedValue(image());
    await run('<img src="https://cdn.example.com/a.png?x=1&amp;y=2" alt="a">');
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example.com/a.png?x=1&y=2", expect.anything());
  });
});

describe("zipPath", () => {
  it.each([
    ["doc", "./img/a.png", "doc/img/a.png"],
    ["doc", "img\\a.png", "doc/img/a.png"],
    ["doc", "img/a%20b.png?x=1#y", "doc/img/a b.png"],
    ["doc", "../a.png", "a.png"],
    ["", "/a.png", "a.png"],
    ["doc", "../../a.png", null],
    ["", "../a.png", null],
    ["", "%E0%A4%A", null],
  ])("resolves %j + %j to %j", (baseDir, url, expected) => {
    expect(zipPath(baseDir, url)).toBe(expected);
  });
});
