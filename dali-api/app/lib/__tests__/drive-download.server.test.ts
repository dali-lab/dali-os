import { beforeEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";

vi.mock("~/lib/s3", () => ({
  getObjectStream: vi.fn(),
  putObjectStream: vi.fn(),
  deleteObject: vi.fn(),
  getDownloadUrl: vi.fn().mockResolvedValue("https://signed.example/zip"),
}));

import { buildDriveZip, zipSources } from "~/lib/drive-download.server";
import { deleteObject, getDownloadUrl, getObjectStream, putObjectStream } from "~/lib/s3";

const modified = new Date("2026-03-01T12:00:00Z");
const source = (name: string, s3Key = name) => ({ name, s3Key, modified });

function storedAs(contents: Record<string, string[]>) {
  vi.mocked(getObjectStream).mockImplementation(async (key) => {
    const pieces = contents[key];
    if (!pieces) return null;
    return (async function* () {
      for (const piece of pieces) yield new TextEncoder().encode(piece);
    })();
  });
}

async function collect(stream: AsyncIterable<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return new Uint8Array(Buffer.concat(chunks));
}

function read(zip: Uint8Array) {
  return Object.fromEntries(Object.entries(unzipSync(zip)).map(([k, v]) => [k, strFromU8(v)]));
}

beforeEach(() => vi.clearAllMocks());

describe("zipSources", () => {
  it("produces an archive standard readers open, with every file intact", async () => {
    storedAs({ "a.txt": ["hello ", "world"], "b.txt": ["second"] });
    const zip = await collect(zipSources([source("a.txt"), source("b.txt")], () => {}));
    expect(read(zip)).toEqual({ "a.txt": "hello world", "b.txt": "second" });
  });

  it("keeps non-ASCII names", async () => {
    storedAs({ k: ["x"] });
    const zip = await collect(zipSources([source("Résumé 日本語.pdf", "k")], () => {}));
    expect(Object.keys(unzipSync(zip))).toEqual(["Résumé 日本語.pdf"]);
  });

  it("numbers files that would collide instead of overwriting one", async () => {
    storedAs({ k1: ["one"], k2: ["two"] });
    const zip = await collect(zipSources([source("a.pdf", "k1"), source("a.pdf", "k2")], () => {}));
    expect(read(zip)).toEqual({ "a.pdf": "one", "a (1).pdf": "two" });
  });

  it("leaves out a file whose object is gone and reports it", async () => {
    storedAs({ "a.txt": ["a"] });
    const onMissing = vi.fn();
    const zip = await collect(zipSources([source("gone.txt"), source("a.txt")], onMissing));
    expect(read(zip)).toEqual({ "a.txt": "a" });
    expect(onMissing).toHaveBeenCalledWith(expect.objectContaining({ name: "gone.txt" }));
  });

  it("stops when a file's stream fails rather than finishing a short archive", async () => {
    vi.mocked(getObjectStream).mockResolvedValue(
      (async function* () {
        yield new Uint8Array(1);
        throw new Error("read failed");
      })(),
    );
    await expect(collect(zipSources([source("a")], () => {}))).rejects.toThrow("read failed");
  });

  it("reads files one at a time so large selections don't pile up in memory", async () => {
    let open = 0;
    let peak = 0;
    vi.mocked(getObjectStream).mockImplementation(async () =>
      (async function* () {
        peak = Math.max(peak, ++open);
        yield new Uint8Array(1);
        open--;
      })(),
    );
    await collect(zipSources([source("a"), source("b"), source("c")], () => {}));
    expect(peak).toBe(1);
  });
});

describe("buildDriveZip", () => {
  function consumeUpload() {
    vi.mocked(putObjectStream).mockImplementation(async (_key, chunks) => {
      await collect(chunks);
    });
  }

  it("stores under the reserved prefix and links with a .zip name", async () => {
    storedAs({ a: ["a"] });
    consumeUpload();
    expect(await buildDriveZip([source("a")])).toEqual({ url: "https://signed.example/zip", included: 1 });

    const [key, , contentType] = vi.mocked(putObjectStream).mock.calls[0];
    expect(key).toMatch(/^uploads\/drive-downloads\/[0-9a-f-]{36}\.zip$/);
    expect(contentType).toBe("application/zip");
    expect(getDownloadUrl).toHaveBeenCalledWith(key, expect.objectContaining({ fileName: "Drive files.zip" }));
  });

  it("counts only the files that made it in", async () => {
    storedAs({ a: ["a"] });
    consumeUpload();
    expect((await buildDriveZip([source("a"), source("gone")]))?.included).toBe(1);
  });

  it("deletes the object and returns null when nothing could be read", async () => {
    storedAs({});
    consumeUpload();
    expect(await buildDriveZip([source("gone")])).toBeNull();
    expect(deleteObject).toHaveBeenCalledWith(vi.mocked(putObjectStream).mock.calls[0][0]);
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });
});
