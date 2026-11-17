import { beforeEach, describe, expect, it, vi } from "vitest";

const s3 = vi.hoisted(() => ({
  getUploadPost: vi.fn(async (key: string) => ({ url: "https://s3.test", fields: { key } })),
  headObject: vi.fn(),
  getObjectBytes: vi.fn(),
  deleteObject: vi.fn(async () => undefined),
}));
vi.mock("~/lib/s3.server", () => s3);

import {
  assertOwnStatementKey,
  createStatementUpload,
  deleteStatementUpload,
  readStatementText,
  STATEMENT_MAX_BYTES,
} from "../statement-upload.server";

const owner = { userId: "u1", isCore: false, isStaff: false, ownedCardIds: ["c1"] };
const member = { userId: "u2", isCore: false, isStaff: false, ownedCardIds: [] };
const core = { userId: "u3", isCore: true, isStaff: false, ownedCardIds: [] };

beforeEach(() => vi.clearAllMocks());

describe("assertOwnStatementKey", () => {
  it("accepts the caller's own csv key", () => {
    expect(() => assertOwnStatementKey("u1", "uploads/expense-statements/u1/abc.csv")).not.toThrow();
  });
  it.each([
    "uploads/expense-statements/u2/abc.csv",
    "uploads/expense-statements/u1/a/b.csv",
    "uploads/expense-statements/u1/../u2/x.csv",
    "uploads/expense-statements/u1/abc.png",
    "uploads/expense-receipts/u1/abc.csv",
    "uploads/expense-statements/u1/",
  ])("rejects %s", (key) => {
    expect(() => assertOwnStatementKey("u1", key)).toThrow(/isn't yours/);
  });
});

describe("createStatementUpload", () => {
  it("mints a csv key under the caller and caps the size", async () => {
    const r = await createStatementUpload(owner, "c1");
    expect(r.key).toMatch(/^uploads\/expense-statements\/u1\/[0-9a-f-]{36}\.csv$/);
    expect(s3.getUploadPost).toHaveBeenCalledWith(r.key, "text/csv", expect.objectContaining({ maxBytes: STATEMENT_MAX_BYTES }));
  });
  it("allows Core", async () => {
    await expect(createStatementUpload(core, "c1")).resolves.toBeTruthy();
  });
  it("rejects a member who does not own the card", async () => {
    await expect(createStatementUpload(member, "c1")).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("readStatementText", () => {
  const key = "uploads/expense-statements/u1/abc.csv";
  it("decodes the file and drops a BOM", async () => {
    s3.headObject.mockResolvedValue({ sizeBytes: 5, contentType: "text/csv" });
    s3.getObjectBytes.mockResolvedValue({ body: Buffer.from("﻿a,b\n1,2") });
    await expect(readStatementText("u1", key)).resolves.toBe("a,b\n1,2");
  });
  it("rejects another user's key before touching storage", async () => {
    await expect(readStatementText("u2", key)).rejects.toMatchObject({ code: "forbidden" });
    expect(s3.headObject).not.toHaveBeenCalled();
  });
  it("rejects a missing upload", async () => {
    s3.headObject.mockResolvedValue(null);
    await expect(readStatementText("u1", key)).rejects.toMatchObject({ code: "invalid" });
  });
  it("rejects an oversized upload", async () => {
    s3.headObject.mockResolvedValue({ sizeBytes: STATEMENT_MAX_BYTES + 1, contentType: "text/csv" });
    await expect(readStatementText("u1", key)).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("deleteStatementUpload", () => {
  it("deletes only the caller's key", async () => {
    await deleteStatementUpload("u1", "uploads/expense-statements/u1/abc.csv");
    expect(s3.deleteObject).toHaveBeenCalledWith("uploads/expense-statements/u1/abc.csv");
    await expect(deleteStatementUpload("u2", "uploads/expense-statements/u1/abc.csv")).rejects.toBeTruthy();
  });
});
