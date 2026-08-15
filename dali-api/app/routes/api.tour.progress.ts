import type { Route } from "./+types/api.tour.progress";
import { requireAuth, unauthorized } from "~/lib/auth";
import {
  dismissGuide,
  loadGuideState,
  markGuideStarted,
  recordGuideStep,
  resetGuide,
} from "~/lib/guide.server";

// Progress for the interactive guide. The GET is polled by the guide card while
// a gated step is open — it's how "you've now uploaded a photo" gets back to the
// card without a full navigation. Lives under /api/tour so the shell's
// revalidation allowlist (LAYOUT_MUTATING_ACTION_PREFIXES) already covers it.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return unauthorized(request);
  return Response.json(await loadGuideState(auth.user.sub));
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return unauthorized(request);
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  switch (intent) {
    case "start":
      await markGuideStarted(auth.user.sub);
      break;
    case "step": {
      const stepId = String(form.get("stepId") ?? "");
      if (!stepId) return Response.json({ error: "stepId required" }, { status: 400 });
      await recordGuideStep(auth.user.sub, stepId);
      break;
    }
    case "dismiss":
      await dismissGuide(auth.user.sub);
      break;
    case "reset":
      await resetGuide(auth.user.sub);
      break;
    default:
      return Response.json({ error: "Unknown intent" }, { status: 400 });
  }

  return Response.json(await loadGuideState(auth.user.sub));
}
