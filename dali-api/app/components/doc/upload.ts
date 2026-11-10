// Media upload pipeline for the doc editor — same flow as the legacy
// app/components/editor/image.ts (which dies with the TipTap stack): presign →
// direct S3 POST → insert the STABLE session-authed redirect URL, never a
// presigned URL (those expire) and never base64 (bloats every Yjs update).
//
// BlockNote routes all media uploads (image, file, video) through the single
// editor `uploadFile` callback — uploadEditorImage handles all three.

import { galleryDisplaySize, scaledGalleryCopy } from "~/community/lib/gallery";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "~/lib/file-validation";
import { formatBytes, uploadFileToS3 } from "~/lib/upload-client";

export const IMAGE_UPLOAD_ACCEPT = "image/*";
const UPLOAD_KEY_PREFIX = "doc-images";

// A GIF would lose its animation and an SVG has no pixels to reduce.
const NOT_SHRINKABLE = new Set(["image/gif", "image/svg+xml"]);

export function rawUploadUrl(key: string): string {
  return `/api/upload/raw?key=${encodeURIComponent(key)}`;
}

/** The file to upload: an over-cap image as a smaller copy, anything else as
 * it came. A file that can't be shrunk goes through unchanged so the upload
 * reports the size cap. */
async function shrinkToCap(file: File): Promise<File> {
  if (
    file.size <= MAX_UPLOAD_BYTES ||
    !file.type.startsWith("image/") ||
    NOT_SHRINKABLE.has(file.type)
  ) {
    return file;
  }
  // Rejects on formats the browser can't decode, like HEIC outside Safari.
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  try {
    const { width, height } = galleryDisplaySize(bitmap.width, bitmap.height) ?? bitmap;
    const copy = await scaledGalleryCopy(bitmap, width, height, "display");
    if (!copy || copy.size > MAX_UPLOAD_BYTES) return file;
    const stem = file.name.replace(/\.[^.]*$/, "");
    return new File([copy], `${stem}.${copy.name.split(".").pop()}`, { type: copy.type });
  } finally {
    bitmap.close();
  }
}

/** Upload one media file (image, document attachment, or video) and return
 * the stable src to store in the document. Matches BlockNote's `uploadFile`
 * editor option — BlockNote passes the chosen file for image, file, and video
 * blocks through this same callback.
 *
 * No accept filter here: the presign endpoint enforces `isBlockedUpload`
 * (defense-in-depth) and the individual block UIs pass their own accept
 * strings. We upload to the doc-images prefix so all editor media lives
 * under one key namespace. `notify` hears when an image had to be shrunk. */
export async function uploadEditorImage(
  file: File,
  notify?: (message: string) => void,
): Promise<string> {
  const upload = await shrinkToCap(file);
  if (upload !== file) {
    notify?.(
      `Image shrunk from ${formatBytes(file.size)} to ${formatBytes(upload.size)} to fit the ${MAX_UPLOAD_LABEL} limit.`,
    );
  }
  const meta = await uploadFileToS3(upload, UPLOAD_KEY_PREFIX);
  return rawUploadUrl(meta.s3Key);
}

export function uploadErrorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Upload failed";
}

/** BlockNote swallows upload errors: the upload panel shows a generic
 * "Upload failed" and paste/drop show nothing, so surface the real reason
 * (e.g. the size cap) ourselves. Rethrows so BlockNote still resets its UI. */
export function withUploadErrorToast(
  upload: (file: File) => Promise<string>,
  showError: (message: string) => void,
): (file: File) => Promise<string> {
  return async (file) => {
    try {
      return await upload(file);
    } catch (err) {
      showError(uploadErrorMessage(err));
      throw err;
    }
  };
}
