import { useLoaderData, Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/education.offerings.$id.assignments";
import { prisma } from "~/lib/db";
import { requireEducationManager } from "~/education/lib/access";
import { EducationTabs } from "~/education/components/EducationTabs";

export async function loader({ request, params }: Route.LoaderArgs) {
  const gate = await requireEducationManager(request, params.id);
  if (!gate.ok) return gate.response;
  const offering = await prisma.educationOffering.findUnique({
    where: { id: params.id },
    select: { id: true, title: true },
  });
  if (!offering) return new Response("Not found", { status: 404 });
  const assignments = await prisma.educationAssignment.findMany({
    where: {
      OR: [
        { offeringId: params.id },
        { session: { offeringId: params.id } },
      ],
    },
    include: {
      session: { select: { sequence: true } },
      _count: { select: { submissions: true } },
    },
    orderBy: { dueAt: "asc" },
  });
  return { offering, assignments };
}

export async function action({ request, params }: Route.ActionArgs) {
  const gate = await requireEducationManager(request, params.id);
  if (!gate.ok) return gate.response;
  const fd = await request.formData();
  const title = String(fd.get("title") || "").trim();
  const submissionType = String(fd.get("submissionType") || "Text") as
    | "Text"
    | "File"
    | "Mixed";
  const dueAt = String(fd.get("dueAt") || "");
  if (!title) return { error: "title required" };
  await prisma.educationAssignment.create({
    data: {
      offeringId: params.id!,
      title,
      submissionType,
      dueAt: dueAt ? new Date(dueAt) : null,
    },
  });
  return null;
}

export default function Assignments() {
  const { offering, assignments } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  return (
    <div className="max-w-5xl mx-auto p-6">
      <EducationTabs offeringId={offering.id} offeringTitle={offering.title} />
      <Form method="post" className="bg-card border border-border rounded-md p-3 mb-4 flex items-end gap-2">
        <label className="block flex-1">
          <span className="text-xs font-medium text-muted-foreground">Title</span>
          <input
            name="title"
            required
            className="block w-full border border-border rounded-md px-2 py-1 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Type</span>
          <select
            name="submissionType"
            className="block border border-border rounded-md px-2 py-1 text-sm bg-white"
          >
            <option>Text</option>
            <option>File</option>
            <option>Mixed</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Due</span>
          <input
            type="datetime-local"
            name="dueAt"
            className="block border border-border rounded-md px-2 py-1 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={nav.state !== "idle"}
          className="px-3 py-1.5 bg-accent-coral text-white text-sm font-medium rounded-md"
        >
          Add
        </button>
      </Form>
      <ul className="space-y-2">
        {assignments.map((a) => (
          <li
            key={a.id}
            className="bg-card border border-border rounded-md p-3 flex items-center justify-between text-sm"
          >
            <div>
              <Link
                to={`/education/offerings/${offering.id}/assignments/${a.id}`}
                className="font-semibold text-dark-blue hover:underline"
              >
                {a.title}
              </Link>
              <p className="text-xs text-muted-foreground">
                {a.submissionType}
                {a.dueAt
                  ? ` · due ${new Date(a.dueAt).toLocaleDateString()}`
                  : ""}
                {a.session ? ` · session #${a.session.sequence}` : ""}
                {" · "}
                {a._count.submissions} submissions
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
