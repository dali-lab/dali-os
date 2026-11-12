import { getDownloadUrl } from "~/lib/s3.server";
import { isReservedUploadKey, MAX_UPLOAD_BYTES } from "~/lib/file-validation";
import { imageSize, mimeOf } from "./image-size";
import type { ExportImage } from "./export.server";

export const MAX_EXPORT_IMAGE_BYTES = 48 * 1024 * 1024;

export function uploadKeyOf(src: string): string | null {
  let url: URL;
  try {
    url = new URL(src, "http://local.invalid");
  } catch {
    return null;
  }
  if (url.pathname !== "/api/upload/raw") return null;
  const key = url.searchParams.get("key");
  if (!key || !key.startsWith("uploads/") || isReservedUploadKey(key)) return null;
  return key;
}

/** Reads a slide image the way /api/upload/raw serves it: only `uploads/` keys, only unreserved ones, only formats PowerPoint embeds. */
export function createImageLoader(fetchImpl: typeof fetch = fetch): (src: string) => Promise<ExportImage | null> {
  let total = 0;
  return async (src) => {
    const key = uploadKeyOf(src);
    if (!key || total >= MAX_EXPORT_IMAGE_BYTES) return null;
    try {
      const res = await fetchImpl(await getDownloadUrl(key));
      if (!res.ok) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_UPLOAD_BYTES) return null;
      const mime = mimeOf(bytes);
      if (!mime) return null;
      total += bytes.length;
      return { data: `${mime};base64,${Buffer.from(bytes).toString("base64")}`, size: imageSize(bytes) };
    } catch {
      return null;
    }
  };
}
