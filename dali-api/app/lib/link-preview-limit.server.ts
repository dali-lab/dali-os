import { checkRateLimit } from "~/lib/rate-limit";

export const LINK_PREVIEW_LIMIT = { max: 20, windowMs: 60_000 };

export function limitLinkPreviews(request: Request, userId: string): Response | null {
  return checkRateLimit(request, LINK_PREVIEW_LIMIT, `link-preview:${userId}`);
}
