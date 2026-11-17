import { randomUUID } from "node:crypto";
import { deleteObject, getObjectBytes, getUploadPost, headObject } from "~/lib/s3.server";
import { canImportStatement, type ExpenseViewer } from "./access";
import { ExpenseError } from "./errors";

export const STATEMENT_KEY_PREFIX = "uploads/expense-statements/";
export const STATEMENT_MAX_BYTES = 2 * 1024 * 1024;
export const STATEMENT_UPLOAD_TTL_SECONDS = 900;

export function mintStatementKey(userId: string): string {
  return `${STATEMENT_KEY_PREFIX}${userId}/${randomUUID()}.csv`;
}

export function assertOwnStatementKey(userId: string, key: string): void {
  const prefix = `${STATEMENT_KEY_PREFIX}${userId}/`;
  const rest = key.startsWith(prefix) ? key.slice(prefix.length) : "";
  if (!userId || !rest || rest.includes("/") || rest.includes("..") || !rest.endsWith(".csv")) {
    throw new ExpenseError("forbidden", "That statement upload isn't yours.");
  }
}

export async function createStatementUpload(actor: ExpenseViewer, cardId: string) {
  if (!canImportStatement(actor, cardId)) {
    throw new ExpenseError("forbidden", "Only the card owner or Core can import a statement.");
  }
  const key = mintStatementKey(actor.userId);
  const post = await getUploadPost(key, "text/csv", {
    maxBytes: STATEMENT_MAX_BYTES,
    expiresIn: STATEMENT_UPLOAD_TTL_SECONDS,
  });
  return { key, post };
}

export async function readStatementText(userId: string, key: string): Promise<string> {
  assertOwnStatementKey(userId, key);
  const head = await headObject(key);
  if (!head) throw new ExpenseError("invalid", "The statement didn't finish uploading.");
  if (head.sizeBytes > STATEMENT_MAX_BYTES) throw new ExpenseError("invalid", "That statement file is too large.");
  const { body } = await getObjectBytes(key);
  return new TextDecoder().decode(body);
}

export async function deleteStatementUpload(userId: string, key: string): Promise<void> {
  assertOwnStatementKey(userId, key);
  await deleteObject(key).catch(() => undefined);
}
