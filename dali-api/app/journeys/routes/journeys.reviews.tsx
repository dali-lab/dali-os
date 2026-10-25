import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/journeys.reviews";
import { requireJourneyViewer } from "~/journeys/lib/journeys.server";
import { safeJsonParse } from "~/journeys/lib/safe-json-field";
import { listReviews, reviewSubmission } from "~/journeys/lib/studio.server";

export const meta: Route.MetaFunction = () => [{ title: "Reviews · Journeys · DALI OS" }];

export const handle = { fitViewport: true, hideBreadcrumbs: true };

export async function loader({ request }: Route.LoaderArgs) {
  const viewer = await requireJourneyViewer(request);
  return { entries: await listReviews(viewer) };
}

const reviewSchema = z.object({
  submissionId: z.string().min(1),
  decision: z.enum(["approved", "changes-requested"]),
  note: z.string().max(10_000),
  mentorChecks: z.record(z.string(), z.boolean()),
});

export async function action({ request }: Route.ActionArgs) {
  const viewer = await requireJourneyViewer(request);
  const form = await request.formData();
  const parsed = reviewSchema.safeParse({
    submissionId: form.get("submissionId"),
    decision: form.get("decision"),
    note: form.get("note") ?? "",
    mentorChecks: safeJsonParse(form.get("mentorChecks")) ?? {},
  });
  if (!parsed.success) return data({ ok: false as const, error: "That review couldn't be read." }, { status: 400 });
  const { submissionId, ...review } = parsed.data;
  const result = await reviewSubmission(viewer, submissionId, review);
  return result.ok ? result : data(result, { status: result.status });
}

// UI: the review queue and the selected submission. Built in ReviewsPage.
export { ReviewsPage as default } from "~/journeys/components/reviews/ReviewsPage";
