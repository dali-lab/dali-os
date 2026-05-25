import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  fileMatchesAccept,
} from "~/lib/file-validation";

export type UploadedFileMeta = {
  s3Key: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

// Client-side: presign → direct S3 POST. Returns the metadata callers persist
// (e.g. POST /api/projects/:id/files). Mirrors PhotoUploadField's flow but
// generic over file type. `keyPrefix` namespaces the object under uploads/.
export async function uploadFileToS3(
  file: File,
  keyPrefix: string,
  accept?: string,
): Promise<UploadedFileMeta> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large (max ${MAX_UPLOAD_LABEL})`);
  }
  if (accept && !fileMatchesAccept(file.name, file.type, accept)) {
    throw new Error(`File type not allowed. Accepted: ${accept}`);
  }

  const contentType = file.type || "application/octet-stream";
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const key = `${keyPrefix.replace(/^\/+|\/+$/g, "")}/${crypto.randomUUID()}-${safeName}`;

  const presignRes = await fetch("/api/upload/presign", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, contentType, contentLength: file.size, accept }),
  });
  if (!presignRes.ok) {
    const b = (await presignRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(b.error ?? "Failed to get upload URL");
  }
  const { url, fields, key: scopedKey } = (await presignRes.json()) as {
    url: string;
    fields: Record<string, string>;
    key: string;
  };

  const formData = new FormData();
  for (const [n, v] of Object.entries(fields)) formData.append(n, v);
  formData.append("file", file, file.name);
  const uploadRes = await fetch(url, { method: "POST", body: formData });
  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => "");
    if (uploadRes.status === 403 && /EntityTooLarge/i.test(text)) {
      throw new Error(`File too large (max ${MAX_UPLOAD_LABEL})`);
    }
    throw new Error("Upload to storage failed");
  }

  return { s3Key: scopedKey, fileName: file.name, contentType, sizeBytes: file.size };
}

// Human-readable byte size for version lists.
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
