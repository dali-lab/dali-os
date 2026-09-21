import { uploadFileToS3 } from "~/lib/upload-client";
import type { BinaryFileData } from "@excalidraw/excalidraw/types";

// Excalidraw stores each image as a base64 data URL in its files map. To keep
// the CRDT small, we upload the bytes to S3 (reusing the shared presign → direct
// POST path) and store only a stable same-origin URL in the shared scene.
const WHITEBOARD_IMAGE_PREFIX = "whiteboard-images";

function dataUrlToFile(dataURL: string, id: string): File {
  const comma = dataURL.indexOf(",");
  const header = dataURL.slice(0, comma);
  const mime = /^data:([^;]+)/.exec(header)?.[1] ?? "application/octet-stream";
  const binary = atob(dataURL.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ext = mime.split("/")[1]?.split("+")[0] ?? "bin";
  return new File([bytes], `${id}.${ext}`, { type: mime });
}

// Offload an Excalidraw binary file to S3 and return a stable, same-origin URL
// (served by /api/whiteboard/image) to store in the shared scene. Returns null
// when the file isn't a base64 data URL or the upload fails — the caller then
// keeps the original file so images never silently break (e.g. in dev with no
// S3 configured, they stay inline).
export async function uploadWhiteboardImage(file: BinaryFileData): Promise<string | null> {
  const dataURL = file.dataURL;
  if (typeof dataURL !== "string" || !dataURL.startsWith("data:")) return null;
  try {
    const meta = await uploadFileToS3(dataUrlToFile(dataURL, file.id), WHITEBOARD_IMAGE_PREFIX);
    return `/api/whiteboard/image?key=${encodeURIComponent(meta.s3Key)}`;
  } catch {
    return null;
  }
}
