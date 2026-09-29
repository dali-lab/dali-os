import { describe, it, expect, vi, afterAll, afterEach } from "vitest";

// s3.ts reads its bucket and credentials at import. Fake ones are enough to
// sign a policy locally — nothing in this file talks to AWS.
vi.hoisted(() => {
  vi.stubEnv("AWS_REGION", "us-east-1");
  vi.stubEnv("AWS_S3_BUCKET", "test-bucket");
  vi.stubEnv("AWS_ACCESS_KEY_ID", "AKIATESTTESTTEST");
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "test-secret");
});

import { S3Client, NotFound, S3ServiceException } from "@aws-sdk/client-s3";
import { getUploadPost, headObject } from "~/lib/s3";
import { MAX_FILE_STORE_BYTES, MAX_UPLOAD_BYTES } from "~/lib/file-validation";

afterEach(() => vi.restoreAllMocks());
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
