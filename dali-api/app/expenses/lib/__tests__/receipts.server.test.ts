import { beforeEach, describe, expect, it, vi } from "vitest";

const getUploadPost = vi.fn();
vi.mock("~/lib/s3.server", () => ({ getUploadPost: (...a: unknown[]) => getUploadPost(...a) }));

import {
  ReceiptKeyError,
  assertOwnReceiptKey,
  createReceiptUpload,
  mintReceiptKey,
  sha256Hex,
} from "../receipts.server";

beforeEach(() => vi.clearAllMocks());

describe("mintReceiptKey", () => {
  it("keys under the caller's id and never repeats", () => {
    const a = mintReceiptKey("u1");
    expect(a).toMatch(/^uploads\/expense-receipts\/u1\/[0-9a-f-]{36}$/);
    expect(mintReceiptKey("u1")).not.toBe(a);
  });
});

describe("assertOwnReceiptKey", () => {
  it("accepts the caller's own key", () => {
    expect(() => assertOwnReceiptKey("u1", mintReceiptKey("u1"))).not.toThrow();
  });
  it.each([
    ["another user's key", "uploads/expense-receipts/u2/abc"],
    ["a different folder", "uploads/drive/u1/abc"],
    ["a user-id prefix collision", "uploads/expense-receipts/u10/abc"],
    ["a nested path", "uploads/expense-receipts/u1/a/b"],
    ["a traversal", "uploads/expense-receipts/u1/../u2/abc"],
    ["no file name", "uploads/expense-receipts/u1/"],
    ["an empty key", ""],
  ])("rejects %s", (_n, key) => {
    expect(() => assertOwnReceiptKey("u1", key)).toThrow(ReceiptKeyError);
  });
  it("rejects an empty user id", () => {
    expect(() => assertOwnReceiptKey("", "uploads/expense-receipts//abc")).toThrow(ReceiptKeyError);
  });
});

describe("createReceiptUpload", () => {
  it("presigns a POST for an allowed type with the shared size limit", async () => {
    getUploadPost.mockResolvedValue({ url: "https://s3", fields: {} });
    const r = await createReceiptUpload("u1", "application/pdf");
    expect(getUploadPost).toHaveBeenCalledWith(r.key, "application/pdf");
    expect(r.post).toEqual({ url: "https://s3", fields: {} });
  });
  it.each(["image/heic", "image/gif", "text/plain"])("rejects %s", async (type) => {
    await expect(createReceiptUpload("u1", type)).rejects.toThrow(ReceiptKeyError);
    expect(getUploadPost).not.toHaveBeenCalled();
  });
});

describe("sha256Hex", () => {
  it("hashes bytes", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
