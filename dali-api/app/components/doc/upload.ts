// Image upload pipeline for the doc editor — same flow as the legacy
// app/components/editor/image.ts (which dies with the TipTap stack): presign →
// direct S3 POST → insert the STABLE session-authed redirect URL, never a
// presigned URL (those expire) and never base64 (bloats every Yjs update).

import { uploadFileToS3 } from "~/lib/upload-client";

export const IMAGE_UPLOAD_ACCEPT = "image/*";
const UPLOAD_KEY_PREFIX = "doc-images";

export function rawUploadUrl(key: string): string {
  return `/api/upload/raw?key=${encodeURIComponent(key)}`;
}

/** Upload one image file and return the stable src to store in the document.
 * Shape matches BlockNote's `uploadFile` editor option. */
export async function uploadEditorImage(file: File): Promise<string> {
  const meta = await uploadFileToS3(file, UPLOAD_KEY_PREFIX, IMAGE_UPLOAD_ACCEPT);
  return rawUploadUrl(meta.s3Key);
}
