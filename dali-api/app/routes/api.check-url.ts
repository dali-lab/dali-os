import type { Route } from "./+types/api.check-url";
import { requireAuth } from "~/lib/auth";
import { checkGitHubUrl, checkFigmaUrl } from "~/lib/submission-check";
import { checkRateLimit } from "~/lib/rate-limit";
import { safeJson } from "~/lib/safe-json";

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const userLimited = checkRateLimit(request, { max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS }, auth.user.sub);
  if (userLimited) return userLimited;

  const body = await safeJson<{ url: string; type: "github_url" | "figma_url" }>(request);
  if (body instanceof Response) return body;
  const { url, type } = body;

  if (!url || typeof url !== "string") {
    return Response.json(
      { status: "invalid_url", url: "", message: "No URL provided" },
      { status: 400 },
    );
  }

  const result = type === "figma_url"
    ? await checkFigmaUrl(url)
    : await checkGitHubUrl(url);
  return Response.json(result);
}
