import { redirect, useLoaderData, Form, Link } from "react-router";
import { redirectToLogin } from "~/lib/login-next";
import type { Route } from "./+types/education.manage.assignments.$assignmentId";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { requireOfferingManager } from "~/education/lib/access.server";
import {
  offeringIdForAssignment,
  listSubmissions,
  gradeSubmission,
} from "~/education/lib/assignments.server";
import { readDocAsBlocks } from "~/collab/read";
import { Button } from "~/components/ui/Button";
import { DocEditor, countWords } from "~/components/doc";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { parseSessionCookie } from "~/lib/cookies";
import { formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `Grade ${data?.assignment.title ?? "Assignment"} · DALI OS` },
];

export const handle = {
  breadcrumb: (data: { assignment: { title: string } } | undefined) =>
    data?.assignment.title ?? "Assignment",
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);

  const offeringId = await offeringIdForAssignment(params.assignmentId!);
  if (!offeringId) throw new Response("Not found", { status: 404 });
  const gate = await requireOfferingManager(request, offeringId);
  if (!gate.ok) return redirect("/portal");

  const [assignment, submissions] = await Promise.all([
    prisma.educationAssignment.findUnique({
      where: { id: params.assignmentId },
      select: { id: true, title: true, dueAt: true, submissionType: true, points: true },
    }),
    listSubmissions(params.assignmentId!),
  ]);
  if (!assignment) throw new Response("Not found", { status: 404 });

  // For Doc-type assignments, read each student's collab doc server-side so
  // the instructor sees the content read-only. readDocAsBlocks handles missing
  // rows (doc never opened) by returning []. This avoids decoding a live Y.Doc
  // (CLAUDE.md rule) — reads go through the read.ts helper.
  const submissionsWithDocs = await Promise.all(
    submissions.map(async (s) => ({
      ...s,
      files: (s.files as { key: string; name: string }[]) ?? [],
      docContent: s.contentDocId
        ? await readDocAsBlocks(s.contentDocId)
        : null,
    })),
  );

  return {
    offeringId,
    assignment,
    submissions: submissionsWithDocs,
    collabToken: parseSessionCookie(request),
    userName: `${auth.user.firstName ?? ""} ${auth.user.lastName ?? ""}`.trim(),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const offeringId = await offeringIdForAssignment(params.assignmentId!);
  if (!offeringId) return Response.json({ error: "Not found" }, { status: 404 });
  const gate = await requireOfferingManager(request, offeringId);
  if (!gate.ok) return gate.response;

  const formData = await request.formData();
  if (formData.get("intent") !== "grade-submission")
    return Response.json({ error: "Unknown intent" }, { status: 400 });
  const scoreRaw = String(formData.get("score") ?? "");
  const scoreParsed = scoreRaw !== "" ? parseInt(scoreRaw, 10) : null;
  const result = await gradeSubmission({
    submissionId: String(formData.get("submissionId") ?? ""),
    offeringId,
    grade: String(formData.get("grade") ?? ""),
    score: Number.isFinite(scoreParsed) ? scoreParsed : null,
    actorId: auth.user.sub,
  });
  if ("error" in result)
    return Response.json({ error: result.error }, { status: result.status });
  return { ok: true };
}

export default function GradeAssignment() {
  const { offeringId, assignment, submissions, collabToken, userName } =
    useLoaderData<typeof loader>();
  const tz = useUserTimeZone();

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <header>
        <p className="text-xs text-muted-foreground">
          <Link
            to={`/education/manage/${offeringId}?tab=assignments`}
            className="hover:underline"
          >
            ← Assignments
          </Link>
        </p>
        <h1 className="mt-1 font-heading text-2xl font-bold text-foreground">
          {assignment.title}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {assignment.dueAt
            ? `Due ${formatDateTime(assignment.dueAt, tz)}`
            : "No due date"}
          {" · "}
          {submissions.length} submission{submissions.length === 1 ? "" : "s"}
        </p>
      </header>

      {submissions.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No submissions yet.</p>
      ) : (
        submissions.map((s) => (
          <div key={s.id} className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-semibold text-foreground">
                {`${s.student.firstName} ${s.student.lastName}`.trim()}
              </p>
              <p className="text-xs text-muted-foreground">
                {s.submittedAt ? `Submitted ${formatDateTime(s.submittedAt, tz)}` : "Not submitted"}
                {s.gradedAt ? ` · Graded ${formatDateTime(s.gradedAt, tz)}` : ""}
              </p>
            </div>

            {/* Text / Mixed */}
            {s.textContent && (
              <p className="mt-2 text-sm text-foreground whitespace-pre-wrap border-l-2 border-border pl-3">
                {s.textContent}
              </p>
            )}
            {/* File / Mixed */}
            {s.files.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {s.files.map((f) => (
                  <li key={f.key}>
                    <a
                      href={`/api/upload/raw?key=${encodeURIComponent(f.key)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-accent-coral hover:underline"
                    >
                      {f.name}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {/* Link */}
            {s.link && (
              <p className="mt-2">
                <a
                  href={s.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-accent-coral hover:underline break-all"
                >
                  {s.link}
                </a>
              </p>
            )}
            {/* Complete */}
            {assignment.submissionType === "Complete" && s.submittedAt && (
              <p className="mt-2 text-sm text-muted-foreground italic">
                Marked complete on {formatDateTime(s.submittedAt, tz)}
              </p>
            )}
            {/* Doc — read-only server-rendered blocks */}
            {s.docContent !== null && s.docContent !== undefined && (
              <div className="mt-2 border-l-2 border-border pl-3">
                {countWords(s.docContent) > 0 ? (
                  <DocEditor
                    features="notes"
                    editable={false}
                    initialContent={s.docContent}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    No content written yet.
                  </p>
                )}
              </div>
            )}

            <div className="mt-3 pt-3 border-t border-border flex flex-col gap-3">
              <div>
                <p className="text-xs font-semibold text-muted-foreground">
                  Feedback (shown to the student once graded — saves as you type)
                </p>
                {collabToken ? (
                  <PresenceProvider
                    pageId={`edusubmission:${s.id}`}
                    token={collabToken}
                    userName={userName}
                  >
                    <DocEditor
                      features="notes"
                      collab={{
                        documentName: `edusubmission:${s.id}:feedback`,
                        token: collabToken,
                        userName,
                      }}
                      placeholder="Nice work — consider…"
                      className="mt-1 border border-border rounded-md"
                    />
                  </PresenceProvider>
                ) : (
                  <p className="text-xs text-muted-foreground italic mt-1">
                    Sign in again to edit feedback.
                  </p>
                )}
              </div>
              <Form method="post" className="flex items-end gap-3">
                <input type="hidden" name="intent" value="grade-submission" />
                <input type="hidden" name="submissionId" value={s.id} />
                {assignment.points != null && (
                  <label className="block">
                    <span className="text-xs font-semibold text-muted-foreground">
                      Score (out of {assignment.points})
                    </span>
                    <input
                      type="number"
                      name="score"
                      min={0}
                      max={assignment.points}
                      defaultValue={s.score ?? ""}
                      placeholder="—"
                      className="mt-1 w-24 rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                    />
                  </label>
                )}
                <label className="block">
                  <span className="text-xs font-semibold text-muted-foreground">Grade</span>
                  <input
                    type="text"
                    name="grade"
                    defaultValue={s.grade ?? ""}
                    placeholder="Complete"
                    className="mt-1 w-40 rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                  />
                </label>
                <Button type="submit" variant="secondary" size="sm">
                  {s.gradedAt ? "Update grade" : "Release grade"}
                </Button>
              </Form>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
