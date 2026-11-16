import { resolvePhotoUrl } from "~/lib/photo";

const isPattern = (value: string | null | undefined): value is string => !!value && value.startsWith("pattern:");

export const externalImageUrl = (value: string | null | undefined): string | null =>
  isPattern(value) ? null : (value ?? null);

export async function resolveProjectCover(value: string | null | undefined): Promise<string | null> {
  return isPattern(value) ? value : resolvePhotoUrl(value);
}
