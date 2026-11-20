import { createHash, randomUUID } from "node:crypto";
import { BadRequestError } from "~/lib/http-error";
import { getUploadPost } from "~/lib/s3.server";

export const RECEIPT_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type ReceiptContentType = (typeof RECEIPT_CONTENT_TYPES)[number];

export const RECEIPT_KEY_PREFIX = "uploads/expense-receipts/";

export class ReceiptKeyError extends BadRequestError {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptKeyError";
  }
}

export function isReceiptContentType(value: string): value is ReceiptContentType {
  return (RECEIPT_CONTENT_TYPES as readonly string[]).includes(value);
}

export function mintReceiptKey(userId: string): string {
  return `${RECEIPT_KEY_PREFIX}${userId}/${randomUUID()}`;
}

export function assertOwnReceiptKey(userId: string, key: string): void {
  const prefix = `${RECEIPT_KEY_PREFIX}${userId}/`;
  const rest = key.startsWith(prefix) ? key.slice(prefix.length) : "";
  if (!userId || !rest || rest.includes("/") || rest.includes("..")) {
    throw new ReceiptKeyError("That receipt upload isn't yours.");
  }
}

export async function createReceiptUpload(userId: string, contentType: string) {
  if (!isReceiptContentType(contentType)) {
    throw new ReceiptKeyError("Receipts can be JPEG, PNG, WebP or PDF files.");
  }
  const key = mintReceiptKey(userId);
  const post = await getUploadPost(key, contentType);
  return { key, post, contentType };
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
