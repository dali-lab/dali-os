export const RAW_UPLOAD_PATH = "/api/upload/raw";

export function rawUploadSrc(key: string): string {
  return `${RAW_UPLOAD_PATH}?key=${encodeURIComponent(key)}`;
}
