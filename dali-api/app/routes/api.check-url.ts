import type { Route } from "./+types/api.check-url";
import { requireAuth } from "~/lib/auth";
import { checkGitHubUrl, checkFigmaUrl } from "~/lib/submission-check";

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const { url, type } = (await request.json()) as { url: string; type: "github_url" | "figma_url" };

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
