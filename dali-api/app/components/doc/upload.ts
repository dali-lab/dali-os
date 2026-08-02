// Media upload pipeline for the doc editor — same flow as the legacy
// app/components/editor/image.ts (which dies with the TipTap stack): presign →
// direct S3 POST → insert the STABLE session-authed redirect URL, never a
// presigned URL (those expire) and never base64 (bloats every Yjs update).
//
// BlockNote routes all media uploads (image, file, video) through the single
// editor `uploadFile` callback — uploadEditorImage handles all three.

import { uploadFileToS3 } from "~/lib/upload-client";

export const IMAGE_UPLOAD_ACCEPT = "image/*";
const UPLOAD_KEY_PREFIX = "doc-images";

export function rawUploadUrl(key: string): string {
  return `/api/upload/raw?key=${encodeURIComponent(key)}`;
}

/** Upload one media file (image, document attachment, or video) and return
 * the stable src to store in the document. Matches BlockNote's `uploadFile`
 * editor option — BlockNote passes the chosen file for image, file, and video
 * blocks through this same callback.
 *
 * No accept filter here: the presign endpoint enforces `isBlockedUpload`
 * (defense-in-depth) and the individual block UIs pass their own accept
 * strings. We upload to the doc-images prefix so all editor media lives
 * under one key namespace. */
export async function uploadEditorImage(file: File): Promise<string> {
  const meta = await uploadFileToS3(file, UPLOAD_KEY_PREFIX);
  return rawUploadUrl(meta.s3Key);
}
