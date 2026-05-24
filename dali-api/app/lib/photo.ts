import { getDownloadUrl } from "./s3";

// A stored User.photoUrl is one of:
//   - an S3 object key under `uploads/` (avatars uploaded through this app), or
//   - a legacy full URL pasted into the old free-text "Photo URL" field, or
//   - null.
// Keys are private objects, so they need a short-lived presigned read URL;
// everything else renders as-is. Resolve in loaders so display components keep
// receiving a ready-to-use src and behave exactly as before.
export async function resolvePhotoUrl(
  value: string | null | undefined,
): Promise<string | null> {
  if (!value) return null;
  if (value.startsWith("uploads/")) return getDownloadUrl(value);
  return value;
}
