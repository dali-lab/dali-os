import type { Route } from "./+types/api.check-url";
import { z } from "zod";
import { requireAuth } from "~/lib/auth";
import { checkGitHubUrl, checkFigmaUrl, checkDriveUrl } from "~/hiring/lib/submission-check";
import { checkRateLimit } from "~/lib/rate-limit";
import { parseJson } from "~/lib/validate";

const CheckUrlSchema = z.object({
  url: z.string().min(1).max(2048),
  type: z.enum(["github_url", "figma_url", "drive_url"]),
});

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const userLimited = checkRateLimit(request, { max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS }, auth.user.sub);
  if (userLimited) return userLimited;

  const body = await parseJson(request, CheckUrlSchema);
  if (body instanceof Response) return body;
  const { url, type } = body;

  const result =
    type === "figma_url"
      ? await checkFigmaUrl(url)
      : type === "drive_url"
        ? await checkDriveUrl(url)
        : await checkGitHubUrl(url);
  return Response.json(result);
}
