import { describe, it, expect, vi, afterAll, afterEach } from "vitest";

// s3.ts reads its bucket and credentials at import. Fake ones are enough to
// sign a policy locally — nothing in this file talks to AWS.
vi.hoisted(() => {
  vi.stubEnv("AWS_REGION", "us-east-1");
  vi.stubEnv("AWS_S3_BUCKET", "test-bucket");
  vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIATESTTESTTEST");
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "test-secret");
});

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  NoSuchKey,
  NotFound,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import {
  attachmentDisposition,
  getDownloadUrl,
  getObjectStream,
  getObjectWithMetadata,
  getUploadPost,
  headObject,
  putObject,
  putObjectStream,
} from "~/lib/s3.server";
import { MAX_FILE_STORE_BYTES, MAX_UPLOAD_BYTES } from "~/lib/file-validation";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
afterAll(() => vi.unstubAllEnvs());

function decodePolicy(fields: Record<string, string>) {
  return JSON.parse(Buffer.from(fields.Policy, "base64").toString("utf8")) as {
    expiration: string;
    conditions: unknown[];
  };
}

function minutesUntil(iso: string): number {
  return (Date.parse(iso) - Date.now()) / 60_000;
}

// The signed policy is the real limit — the presign route's 413 is only UX.
// These decode what S3 will actually be handed.
describe("getUploadPost", () => {
  it("signs the exact key, the Content-Type and the cap it is given", async () => {
    const key = "uploads/project-files/p1/uuid-deck.pdf";
    const { fields } = await getUploadPost(key, "application/pdf", {
      maxBytes: MAX_FILE_STORE_BYTES,
      expiresIn: 900,
    });
    const policy = decodePolicy(fields);

    expect(policy.conditions).toContainEqual(["content-length-range", 0, MAX_FILE_STORE_BYTES]);
    expect(policy.conditions).toContainEqual(["eq", "$Content-Type", "application/pdf"]);
    expect(policy.conditions).toContainEqual({ key });
    expect(fields.key).toBe(key);
    expect(minutesUntil(policy.expiration)).toBeGreaterThan(14);
    expect(minutesUntil(policy.expiration)).toBeLessThanOrEqual(15);
  });

  it("defaults to the general 10 MB cap and five minutes", async () => {
    const { fields } = await getUploadPost("uploads/avatars/me.png", "image/png");
    const policy = decodePolicy(fields);

    expect(policy.conditions).toContainEqual(["content-length-range", 0, MAX_UPLOAD_BYTES]);
    expect(minutesUntil(policy.expiration)).toBeLessThanOrEqual(5);
  });
});

describe("headObject", () => {
  it("returns the stored size and type", async () => {
    vi.spyOn(S3Client.prototype, "send").mockResolvedValueOnce({
      ContentLength: 73_400_320,
      ContentType: "application/pdf",
    } as never);
    await expect(headObject("uploads/x.pdf")).resolves.toEqual({
      sizeBytes: 73_400_320,
      contentType: "application/pdf",
    });
  });

  it("returns null when the key doesn't exist", async () => {
    vi.spyOn(S3Client.prototype, "send").mockRejectedValueOnce(
      new NotFound({ message: "Not Found", $metadata: { httpStatusCode: 404 } }),
    );
    await expect(headObject("uploads/missing.pdf")).resolves.toBeNull();
  });

  it("rethrows anything else, e.g. the 403 a missing key gets without ListBucket", async () => {
    const forbidden = new S3ServiceException({
      name: "Unknown",
      $fault: "client",
      message: "Forbidden",
      $metadata: { httpStatusCode: 403 },
    });
    vi.spyOn(S3Client.prototype, "send").mockRejectedValueOnce(forbidden);
    await expect(headObject("uploads/x.pdf")).rejects.toBe(forbidden);
  });
});

describe("getDownloadUrl cacheFor", () => {
  const key = "uploads/gallery/u1/photo.jpg";
  const at = (iso: string) => vi.useFakeTimers({ now: new Date(iso), toFake: ["Date"] });

  it("gives every request in the same window the identical URL", async () => {
    at("2026-10-22T14:05:00Z");
    const first = await getDownloadUrl(key, { cacheFor: 3600 });
    at("2026-10-22T14:55:00Z");
    expect(await getDownloadUrl(key, { cacheFor: 3600 })).toBe(first);
  });

  it("moves to a new URL in the next window", async () => {
    at("2026-10-22T14:59:00Z");
    const before = await getDownloadUrl(key, { cacheFor: 3600 });
    at("2026-10-22T15:01:00Z");
    expect(await getDownloadUrl(key, { cacheFor: 3600 })).not.toBe(before);
  });

  it("signs from the window start, valid for two windows, with an immutable Cache-Control", async () => {
    at("2026-10-22T14:40:00Z");
    const url = new URL(await getDownloadUrl(key, { cacheFor: 3600 }));
    expect(url.searchParams.get("X-Amz-Date")).toBe("20261022T140000Z");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("7200");
    expect(url.searchParams.get("response-cache-control")).toBe("private, max-age=7200, immutable");
  });

  it("leaves ordinary links signed at the current time with no cache header", async () => {
    at("2026-10-22T14:40:12Z");
    const url = new URL(await getDownloadUrl(key));
    expect(url.searchParams.get("X-Amz-Date")).toBe("20261022T144012Z");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(url.searchParams.has("response-cache-control")).toBe(false);
  });
});

describe("attachmentDisposition", () => {
  it("keeps a plain name readable in both forms", () => {
    expect(attachmentDisposition("Report.pdf")).toBe(
      `attachment; filename="Report.pdf"; filename*=UTF-8''Report.pdf`,
    );
  });

  it("carries non-ASCII names in filename* with an ASCII fallback", () => {
    const value = attachmentDisposition("Screenshot 9.41 PM.png");
    expect(value).toContain(`filename="Screenshot 9.41_PM.png"`);
    expect(value).toContain(`filename*=UTF-8''Screenshot%209.41%E2%80%AFPM.png`);
  });

  it("can't be broken out of with quotes, backslashes or newlines", () => {
    const value = attachmentDisposition('a"\\\r\nb.pdf');
    expect(value).toBe(`attachment; filename="ab.pdf"; filename*=UTF-8''ab.pdf`);
  });

  it("drops a lone surrogate instead of throwing", () => {
    expect(attachmentDisposition("a\ud83d.pdf")).toContain(`filename="a.pdf"`);
  });

  it("escapes the characters encodeURIComponent leaves alone", () => {
    expect(attachmentDisposition("it's (1).pdf")).toContain("filename*=UTF-8''it%27s%20%281%29.pdf");
  });
});

describe("getDownloadUrl filenames", () => {
  it("signs the attachment disposition for a named file", async () => {
    const url = new URL(await getDownloadUrl("uploads/a.pdf", { fileName: "Résumé.pdf" }));
    expect(url.searchParams.get("response-content-disposition")).toBe(attachmentDisposition("Résumé.pdf"));
  });

  it("stays inline when asked, even with a name", async () => {
    const url = new URL(await getDownloadUrl("uploads/a.pdf", { fileName: "a.pdf", inline: true }));
    expect(url.searchParams.get("response-content-disposition")).toBe("inline");
  });
});

describe("getObjectStream", () => {
  it("returns the object's body", async () => {
    const body = (async function* () {
      yield new Uint8Array([1]);
    })();
    vi.spyOn(S3Client.prototype, "send").mockResolvedValue({ Body: body } as never);
    expect(await getObjectStream("uploads/a")).toBe(body);
  });

  it("returns null for a missing key", async () => {
    vi.spyOn(S3Client.prototype, "send").mockRejectedValue(
      new NoSuchKey({ message: "gone", $metadata: {} }) as never,
    );
    expect(await getObjectStream("uploads/a")).toBeNull();
  });

  it("rethrows other storage errors", async () => {
    vi.spyOn(S3Client.prototype, "send").mockRejectedValue(new Error("boom") as never);
    await expect(getObjectStream("uploads/a")).rejects.toThrow("boom");
  });
});

describe("getObjectWithMetadata", () => {
  it("returns the bytes and the stored metadata", async () => {
    vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array([7, 8]) },
      Metadata: { v: "abc" },
    } as never);
    expect(await getObjectWithMetadata("slides/a.png")).toEqual({ body: Buffer.from([7, 8]), metadata: { v: "abc" } });
  });

  it("returns null for a missing key and rethrows other errors", async () => {
    const send = vi.spyOn(S3Client.prototype, "send");
    send.mockRejectedValueOnce(new NoSuchKey({ message: "gone", $metadata: {} }) as never);
    expect(await getObjectWithMetadata("slides/a.png")).toBeNull();
    send.mockRejectedValueOnce(new Error("boom") as never);
    await expect(getObjectWithMetadata("slides/a.png")).rejects.toThrow("boom");
  });
});

describe("putObject", () => {
  it("sends metadata only when given", async () => {
    const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);
    await putObject("slides/a.png", new Uint8Array([1]), "image/png", { v: "abc" });
    await putObject("uploads/b.pdf", new Uint8Array([1]), "application/pdf");
    const inputs = send.mock.calls.map((c) => (c[0] as unknown as { input: Record<string, unknown> }).input);
    expect(inputs[0]).toMatchObject({ Key: "slides/a.png", ContentType: "image/png", Metadata: { v: "abc" } });
    expect(inputs[1]).not.toHaveProperty("Metadata");
  });
});

describe("putObjectStream", () => {
  const MB = 1024 * 1024;
  async function* chunks(...sizes: number[]) {
    for (const size of sizes) yield new Uint8Array(size);
  }
  function fakeS3() {
    return vi.spyOn(S3Client.prototype, "send").mockImplementation((async (command: unknown) => {
      if (command instanceof CreateMultipartUploadCommand) return { UploadId: "up1" };
      if (command instanceof UploadPartCommand) return { ETag: `e${command.input.PartNumber}` };
      return {};
    }) as never);
  }
  const sent = <T,>(spy: ReturnType<typeof fakeS3>, type: new (...args: never[]) => T) =>
    spy.mock.calls.map(([c]) => c).filter((c) => c instanceof type) as T[];

  it("splits into parts of at least 8 MB and completes them in order", async () => {
    const s3 = fakeS3();
    await putObjectStream("uploads/z.zip", chunks(5 * MB, 5 * MB, MB), "application/zip");

    const parts = sent(s3, UploadPartCommand);
    expect(parts.map((p) => (p.input.Body as Buffer).length)).toEqual([10 * MB, MB]);
    const [complete] = sent(s3, CompleteMultipartUploadCommand);
    expect(complete.input.MultipartUpload?.Parts).toEqual([
      { ETag: "e1", PartNumber: 1 },
      { ETag: "e2", PartNumber: 2 },
    ]);
    expect(sent(s3, CreateMultipartUploadCommand)[0].input.ContentType).toBe("application/zip");
  });

  it("doesn't send an empty trailing part", async () => {
    const s3 = fakeS3();
    await putObjectStream("uploads/z.zip", chunks(8 * MB), "application/zip");
    expect(sent(s3, UploadPartCommand)).toHaveLength(1);
  });

  it("aborts the upload when the source fails, and rethrows", async () => {
    const s3 = fakeS3();
    async function* failing() {
      yield new Uint8Array(1);
      throw new Error("source died");
    }
    await expect(putObjectStream("uploads/z.zip", failing(), "application/zip")).rejects.toThrow("source died");
    expect(sent(s3, AbortMultipartUploadCommand)[0].input.UploadId).toBe("up1");
    expect(sent(s3, CompleteMultipartUploadCommand)).toHaveLength(0);
  });
});
