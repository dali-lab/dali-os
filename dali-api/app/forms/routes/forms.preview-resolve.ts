// Staff-only resource route backing the form editor's "Preview" button.
// `reference` questions store only a source key (e.g. "projects:open") — the
// real fill page resolves live choices server-side (loadPublicForm). The
// preview modal needs the same resolution for un-submitted draft/builder
// state, which has no versionId to look up, so this takes the questions
// directly off the request instead.

import type { Route } from "./+types/forms.preview-resolve";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { isQuestionArray } from "~/forms/lib/forms-data";
import { resolveReferenceOptions } from "~/forms/lib/reference-sources";
import { normalizeQuestionBodies } from "~/lib/question-blocks.server";

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) return forbidden(request);

  const formData = await request.formData();
  let questions: unknown;
  try {
    questions = JSON.parse(String(formData.get("questions") ?? ""));
  } catch {
    return Response.json({ error: "Could not parse questions." }, { status: 400 });
  }
  if (!isQuestionArray(questions)) {
    return Response.json({ error: "Could not parse questions." }, { status: 400 });
  }

  const resolved = await Promise.all(
    questions.map(async (q) => {
      if (q.type !== "reference") return q;
      const options = await resolveReferenceOptions(q.data.referenceSource, {
        userId: auth.user.sub,
        termId: q.data.referenceTermId,
      });
      return { ...q, data: { ...q.data, referenceOptions: options } };
    }),
  );

  return { ok: true, questions: normalizeQuestionBodies(resolved) };
}
