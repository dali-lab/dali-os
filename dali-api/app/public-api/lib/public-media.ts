// Image URLs in public API responses.
//
// Uploaded images live in a private S3 bucket, and the presigned URLs
// resolvePhotoUrl hands out expire in an hour — fine for a logged-in page
// load, useless in a response the website caches and a browser holds onto.
// So public responses carry a stable, opaque path instead
// (`/api/media?key=uploads/...`) which the website's own Express server
// proxies, attaching the shared secret server-side. The browser never sees a
// dali-api URL or a credential.
//
// Values that are already absolute URLs (legacy pasted links) pass through
// untouched — there is nothing to proxy.

const MEDIA_PATH = "/api/media";

export function publicMediaUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `${MEDIA_PATH}?key=${encodeURIComponent(value)}`;
}

// Guards the media route. Only objects the app itself uploaded are readable —
// without this, the secret would be a key to arbitrary bucket paths.
export function isServableMediaKey(key: string): boolean {
  return key.startsWith("uploads/") && !key.includes("..");
}
