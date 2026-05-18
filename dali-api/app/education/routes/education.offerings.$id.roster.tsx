import { useLoaderData, Form, useNavigation } from "react-router";
import type { Route } from "./+types/education.offerings.$id.roster";
import { prisma } from "~/lib/db";
import { requireEducationManager } from "~/education/lib/access";
import { decide, type DecisionAction } from "~/lib/education/decisions";
import { EducationTabs } from "~/education/components/EducationTabs";

export async function loader({ request, params }: Route.LoaderArgs) {
  const gate = await requireEducationManager(request, params.id);
  if (!gate.ok) return gate.response;
  const offering = await prisma.educationOffering.findUnique({
    where: { id: params.id },
    select: { id: true, title: true, capacity: true },
  });
  if (!offering) return new Response("Not found", { status: 404 });
  const applications = await prisma.educationApplication.findMany({
    where: { offeringId: params.id },
    orderBy: [{ status: "asc" }, { submittedAt: "asc" }],
    include: {
      applicant: { select: { firstName: true, lastName: true, dartmouthEmail: true } },
      answers: { include: { question: true } },
    },
  });
  return { offering, applications };
}

export async function action({ request, params }: Route.ActionArgs) {
  const gate = await requireEducationManager(request, params.id);
  if (!gate.ok) return gate.response;
  const fd = await request.formData();
  const applicationId = String(fd.get("applicationId"));
  const action = String(fd.get("action")) as DecisionAction;
  const reviewerNote = String(fd.get("reviewerNote") || "") || null;
  if (!["Approve", "Reject", "Waitlist"].includes(action)) {
    return { error: "Invalid action" };
  }
  await decide({
    applicationId,
    action,
    actorUserId: gate.userId,
    reviewerNote,
  });
  return null;
}

const STATUS_ORDER = ["Submitted", "Approved", "Waitlisted", "Rejected", "Withdrawn"];

export default function Roster() {
  const { offering, applications } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const byStatus = STATUS_ORDER.map((s) => ({
    status: s,
    rows: applications.filter((a) => a.status === s),
  }));
  return (
    <div className="max-w-5xl mx-auto p-6">
      <EducationTabs offeringId={offering.id} offeringTitle={offering.title} />
      {byStatus.map(({ status, rows }) => (
        <section key={status} className="mb-6">
          <h2 className="font-heading text-sm font-bold text-muted-foreground uppercase tracking-wide mb-2">
            {status} ({rows.length})
          </h2>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : (
            <ul className="space-y-2">
              {rows.map((a) => (
                <li
                  key={a.id}
                  className="bg-card border border-border rounded-md p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-dark-blue">
                        {a.applicant.firstName} {a.applicant.lastName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {a.applicant.dartmouthEmail ?? "—"} · submitted{" "}
                        {new Date(a.submittedAt).toLocaleDateString()}
                      </p>
                    </div>
                    {(a.status === "Submitted" || a.status === "Waitlisted") && (
                      <Form method="post" className="flex gap-1.5">
                        <input type="hidden" name="applicationId" value={a.id} />
                        <button
                          type="submit"
                          name="action"
                          value="Approve"
                          disabled={nav.state !== "idle"}
                          className="px-2 py-1 bg-green-50 text-green-700 text-xs font-medium rounded"
                        >
                          Approve
                        </button>
                        {a.status === "Submitted" && (
                          <button
                            type="submit"
                            name="action"
                            value="Waitlist"
                            disabled={nav.state !== "idle"}
                            className="px-2 py-1 bg-amber-50 text-amber-700 text-xs font-medium rounded"
                          >
                            Waitlist
                          </button>
                        )}
                        <button
                          type="submit"
                          name="action"
                          value="Reject"
                          disabled={nav.state !== "idle"}
                          className="px-2 py-1 bg-red-50 text-red-700 text-xs font-medium rounded"
                        >
                          Reject
                        </button>
                      </Form>
                    )}
                  </div>
                  {a.answers.length > 0 && (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-muted-foreground">
                        View answers
                      </summary>
                      <dl className="mt-1 space-y-2">
                        {a.answers.map((ans) => (
                          <div key={ans.id}>
                            <dt className="font-medium text-dark-blue">
                              {ans.question.prompt}
                            </dt>
                            <dd className="whitespace-pre-wrap">{ans.content}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
