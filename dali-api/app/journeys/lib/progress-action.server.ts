import { data } from "react-router";
import { z } from "zod";
import { safeJsonParse } from "./safe-json-field";
import { completeSteps, resetProgress, startJourney, type JourneyViewer } from "./journeys.server";
import { resetMyWork, saveMyWork, submitMyWork } from "./studio.server";
import { parseStudioWork } from "./studio-schema";

const selfChecksSchema = z.record(z.string().max(100), z.boolean());

/**
 * The learner's writes, shared by the map and module routes: progress, plus
 * work on a module's whiteboard or document lab (`moduleId` + `work` / `selfChecks` as JSON).
 */
export async function progressAction(request: Request, viewer: JourneyViewer, journeyId: string) {
  const form = await request.formData();
  const moduleId = String(form.get("moduleId") ?? "");
  const result = await (async () => {
    switch (form.get("intent")) {
      case "start":
        return startJourney(viewer, journeyId);
      case "complete":
        return completeSteps(viewer, journeyId, form.getAll("key").map(String));
      case "reset":
        return resetProgress(viewer, journeyId);
      case "lab-save": {
        const work = form.has("work") ? parseStudioWork(safeJsonParse(form.get("work"))) : undefined;
        const selfChecks = form.has("selfChecks") ? selfChecksSchema.safeParse(safeJsonParse(form.get("selfChecks"))) : undefined;
        if (work === null || selfChecks?.success === false) return { ok: false as const, status: 400, error: "That work couldn't be read." };
        return saveMyWork(viewer, journeyId, moduleId, { work, selfChecks: selfChecks?.data });
      }
      case "lab-submit":
        return submitMyWork(viewer, journeyId, moduleId);
      case "lab-reset":
        return resetMyWork(viewer, journeyId, moduleId);
      default:
        return { ok: false as const, status: 400, error: "Unknown action." };
    }
  })();
  return result.ok ? result : data(result, { status: result.status });
}
