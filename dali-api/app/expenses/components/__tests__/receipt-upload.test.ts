import { describe, expect, it, vi } from "vitest";
import {
  MAX_RECEIPT_BYTES,
  MAX_RECEIPT_FILES,
  NATIVE_RECEIPT_TYPES,
  ReceiptUploadError,
  isHeic,
  prepareReceiptFiles,
  receiptType,
  uploadReceiptFiles,
} from "../receipt-upload";

const file = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });

describe("receipt types", () => {
  it("keeps the same accepted list as the server", async () => {
    vi.doMock("~/lib/s3.server", () => ({ getUploadPost: vi.fn() }));
    const { RECEIPT_CONTENT_TYPES } = await import("../../lib/receipts.server");
    expect([...NATIVE_RECEIPT_TYPES]).toEqual([...RECEIPT_CONTENT_TYPES]);
  });
  it("spots HEIC by type or extension", () => {
    expect(isHeic(file("a.HEIC", ""))).toBe(true);
    expect(isHeic(file("a", "image/heif"))).toBe(true);
    expect(isHeic(file("a.jpg", "image/jpeg"))).toBe(false);
  });
  it("rejects types it can't read", () => {
    expect(receiptType(file("a.gif", "image/gif"))).toBeNull();
    expect(receiptType(file("a.pdf", "application/pdf"))).toBe("application/pdf");
    expect(receiptType(file("a.heic", ""))).toBe("image/jpeg");
  });
});

describe("prepareReceiptFiles", () => {
  it("needs at least one file", async () => {
    await expect(prepareReceiptFiles([])).rejects.toThrow(ReceiptUploadError);
  });
  it("caps the number of files", async () => {
    const many = Array.from({ length: MAX_RECEIPT_FILES + 1 }, () => file("a.jpg", "image/jpeg"));
    await expect(prepareReceiptFiles(many)).rejects.toThrow(/up to 12/);
  });
  it("rejects an unsupported file", async () => {
    await expect(prepareReceiptFiles([file("a.gif", "image/gif")])).rejects.toThrow(/JPEG, PNG, WebP or PDF/);
  });
  it("rejects a file over 10 MB", async () => {
    await expect(prepareReceiptFiles([file("big.jpg", "image/jpeg", MAX_RECEIPT_BYTES + 1)])).rejects.toThrow(/10 MB/);
  });
  it("converts HEIC and passes the rest through", async () => {
    const jpeg = file("a.jpg", "image/jpeg");
    const converted = file("b.jpg", "image/jpeg");
    const convert = vi.fn().mockResolvedValue(converted);
    const out = await prepareReceiptFiles([jpeg, file("b.heic", "image/heic")], convert);
    expect(out).toEqual([jpeg, converted]);
    expect(convert).toHaveBeenCalledTimes(1);
  });
  it("surfaces a conversion failure", async () => {
    const convert = vi.fn().mockRejectedValue(new ReceiptUploadError("That photo can't be read in this browser. Save it as a JPEG, PNG or PDF and try again."));
    await expect(prepareReceiptFiles([file("b.heic", "image/heic")], convert)).rejects.toThrow(/JPEG, PNG or PDF/);
  });
});

describe("uploadReceiptFiles", () => {
  const uploads = [
    { key: "k1", contentType: "image/jpeg", post: { url: "https://s3.example/b", fields: { key: "k1", policy: "p" } } },
    { key: "k2", contentType: "application/pdf", post: { url: "https://s3.example/b", fields: { key: "k2" } } },
  ];
  const files = [file("a.jpg", "image/jpeg"), file("b.pdf", "application/pdf")];

  it("presigns once, posts each file to storage and returns the keys in order", async () => {
    const fetchFn = vi.fn(async (url: string, _init?: RequestInit) =>
      url === "/expenses/upload" ? Response.json({ ok: true, uploads }) : new Response(null, { status: 204 }),
    );
    const keys = await uploadReceiptFiles(files, fetchFn as never);
    expect(keys).toEqual(["k1", "k2"]);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    const presign = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string);
    expect(presign).toEqual({ contentTypes: ["image/jpeg", "application/pdf"] });
    const form = (fetchFn.mock.calls[1][1] as RequestInit).body as FormData;
    expect(form.get("policy")).toBe("p");
    expect(form.get("file")).toBeInstanceOf(File);
  });

  it("shows the server's message when presigning fails", async () => {
    const fetchFn = vi.fn(async () => Response.json({ ok: false, error: "Not available." }, { status: 404 }));
    await expect(uploadReceiptFiles(files, fetchFn as never)).rejects.toThrow("Not available.");
  });

  it("fails when storage rejects a file", async () => {
    const fetchFn = vi.fn(async (url: string) =>
      url === "/expenses/upload" ? Response.json({ ok: true, uploads }) : new Response("no", { status: 403 }),
    );
    await expect(uploadReceiptFiles(files, fetchFn as never)).rejects.toThrow(/didn't finish uploading/);
  });
});
