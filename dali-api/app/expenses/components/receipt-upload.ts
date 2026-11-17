export const RECEIPT_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf,image/heic,image/heif,.heic,.heif";
export const NATIVE_RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const MAX_RECEIPT_FILES = 12;
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

export class ReceiptUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptUploadError";
  }
}

const UNREADABLE = "That photo can't be read in this browser. Save it as a JPEG, PNG or PDF and try again.";

export function isHeic(file: Pick<File, "name" | "type">): boolean {
  return /^image\/hei[cf]$/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

export function receiptType(file: Pick<File, "name" | "type">): string | null {
  if ((NATIVE_RECEIPT_TYPES as readonly string[]).includes(file.type)) return file.type;
  return isHeic(file) ? "image/jpeg" : null;
}

export async function convertHeicToJpeg(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob || blob.type !== "image/jpeg") throw new Error("encode");
    return new File([blob], file.name.replace(/\.hei[cf]$/i, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    throw new ReceiptUploadError(UNREADABLE);
  }
}

export async function prepareReceiptFiles(files: File[], convert = convertHeicToJpeg): Promise<File[]> {
  if (files.length === 0) throw new ReceiptUploadError("Choose at least one receipt.");
  if (files.length > MAX_RECEIPT_FILES) {
    throw new ReceiptUploadError(`Use up to ${MAX_RECEIPT_FILES} receipts per expense.`);
  }
  const out: File[] = [];
  for (const file of files) {
    if (!receiptType(file)) {
      throw new ReceiptUploadError(`${file.name || "That file"} isn't a receipt type. Use a JPEG, PNG, WebP or PDF.`);
    }
    const ready = isHeic(file) ? await convert(file) : file;
    if (ready.size > MAX_RECEIPT_BYTES) {
      throw new ReceiptUploadError(`${file.name || "That file"} is over 10 MB.`);
    }
    out.push(ready);
  }
  return out;
}

type Presigned = { key: string; contentType: string; post: { url: string; fields: Record<string, string> } };

export async function uploadReceiptFiles(
  files: File[],
  fetchFn: typeof fetch = fetch,
  presignUrl = "/expenses/upload",
): Promise<string[]> {
  const res = await fetchFn(presignUrl, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentTypes: files.map((f) => f.type) }),
  });
  const body = (await res.json().catch(() => ({}))) as { uploads?: Presigned[]; error?: string };
  if (!res.ok || !body.uploads) throw new ReceiptUploadError(body.error ?? "Couldn't start the upload. Try again.");
  if (body.uploads.length !== files.length) throw new ReceiptUploadError("Couldn't start the upload. Try again.");

  await Promise.all(
    body.uploads.map(async (u, i) => {
      const form = new FormData();
      for (const [name, value] of Object.entries(u.post.fields)) form.append(name, value);
      form.append("file", files[i], files[i].name);
      const r = await fetchFn(u.post.url, { method: "POST", body: form });
      if (!r.ok) throw new ReceiptUploadError("A receipt didn't finish uploading. Try again.");
    }),
  );
  return body.uploads.map((u) => u.key);
}
