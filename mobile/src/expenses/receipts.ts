import * as ImageManipulator from 'expo-image-manipulator';
import type { ExpenseUploadsResponse } from '../api/contract';

export const MAX_RECEIPT_FILES = 10;
const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.8;

export interface ReceiptPhoto {
  id: string;
  uri: string;
  width: number;
  height: number;
}

/** Re-encodes any photo (HEIC included) as a JPEG with its long edge at most 2000px. */
export async function toJpeg(photo: { uri: string; width: number; height: number }): Promise<{ uri: string; width: number; height: number }> {
  const context = ImageManipulator.ImageManipulator.manipulate(photo.uri);
  if (Math.max(photo.width, photo.height) > MAX_EDGE) {
    context.resize(photo.width >= photo.height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: JPEG_QUALITY });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

export function fileNameFor(index: number): string {
  return `receipt-${index + 1}.jpg`;
}

/** POSTs one file to its presigned S3 URL: the returned fields first, then the file. */
export async function uploadToS3(upload: ExpenseUploadsResponse['uploads'][number], file: { uri: string; fileName: string }): Promise<void> {
  const form = new FormData();
  for (const [name, value] of Object.entries(upload.fields)) form.append(name, value);
  form.append('file', { uri: file.uri, name: file.fileName, type: 'image/jpeg' } as unknown as Blob);
  let res: Response;
  try {
    res = await fetch(upload.url, { method: 'POST', body: form });
  } catch {
    throw new Error('Can’t reach the upload server. Check your connection.');
  }
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}
