import { useLoaderData, Form, useNavigation } from "react-router";
import type { Route } from "./+types/education.offerings.$id.settings";
import { prisma } from "~/lib/db";
import { requireEducationManager } from "~/education/lib/access";
import { EducationTabs } from "~/education/components/EducationTabs";

export async function loader({ request, params }: Route.LoaderArgs) {
  const gate = await requireEducationManager(request, params.id);
  if (!gate.ok) return gate.response;
  const offering = await prisma.educationOffering.findUnique({
    where: { id: params.id },
    include: {
      applicationQuestions: { orderBy: { position: "asc" } },
      instructors: {
        include: {
          user: { select: { firstName: true, lastName: true, daliEmail: true } },
        },
      },
    },
  });
  if (!offering) return new Response("Not found", { status: 404 });
  return { offering };
}

export async function action({ request, params }: Route.ActionArgs) {
  const gate = await requireEducationManager(request, params.id);
  if (!gate.ok) return gate.response;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "save");

  if (intent === "publish") {
    await prisma.educationOffering.update({
      where: { id: params.id },
      data: { status: "Published" },
    });
    return null;
  }
  if (intent === "archive") {
    await prisma.educationOffering.update({
      where: { id: params.id },
      data: { status: "Archived" },
    });
    return null;
  }
  if (intent === "addQuestion") {
    const prompt = String(fd.get("prompt") || "").trim();
    if (!prompt) return { error: "prompt required" };
    const max = await prisma.educationApplicationQuestion.aggregate({
      where: { offeringId: params.id! },
      _max: { position: true },
    });
    await prisma.educationApplicationQuestion.create({
      data: {
        offeringId: params.id!,
        prompt,
        position: (max._max.position ?? -1) + 1,
        required: fd.get("required") === "on",
      },
    });
    return null;
  }
  if (intent === "removeQuestion") {
    await prisma.educationApplicationQuestion.delete({
      where: { id: String(fd.get("questionId")) },
    });
    return null;
  }

  // Default: save metadata.
  await prisma.educationOffering.update({
    where: { id: params.id },
    data: {
      title: String(fd.get("title") || ""),
      capacity: Number(fd.get("capacity") || 0),
      requiresReview: fd.get("requiresReview") === "on",
      calendarEmail: String(fd.get("calendarEmail") || "") || null,
    },
  });
  return null;
}

export default function Settings() {
  const { offering } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  return (
    <div className="max-w-3xl mx-auto p-6">
      <EducationTabs offeringId={offering.id} offeringTitle={offering.title} />

      <Form method="post" className="bg-card border border-border rounded-md p-4 mb-4 space-y-3">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Title</span>
          <input
            name="title"
            defaultValue={offering.title}
            className="mt-1 block w-full border border-border rounded-md px-2 py-1 text-sm"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Capacity</span>
            <input
              type="number"
              name="capacity"
              defaultValue={offering.capacity}
              min={1}
              className="mt-1 block w-full border border-border rounded-md px-2 py-1 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">
              Calendar email
            </span>
            <input
              name="calendarEmail"
              defaultValue={offering.calendarEmail ?? ""}
              className="mt-1 block w-full border border-border rounded-md px-2 py-1 text-sm"
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="requiresReview"
            defaultChecked={offering.requiresReview}
          />
          <span>Instructor review required</span>
        </label>
        <button
          type="submit"
          name="intent"
          value="save"
          disabled={nav.state !== "idle"}
          className="px-3 py-1.5 bg-accent-coral text-white text-sm font-medium rounded-md"
        >
          Save metadata
        </button>
      </Form>

      <div className="flex gap-2 mb-6">
        <Form method="post">
          <button
            type="submit"
            name="intent"
            value="publish"
            disabled={offering.status === "Published"}
            className="px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-md disabled:opacity-50"
          >
            Publish
          </button>
        </Form>
        <Form method="post">
          <button
            type="submit"
            name="intent"
            value="archive"
            disabled={offering.status === "Archived"}
            className="px-3 py-1.5 bg-gray-300 text-dark-blue text-sm font-medium rounded-md disabled:opacity-50"
          >
            Archive
          </button>
        </Form>
      </div>

      <h2 className="font-heading font-bold text-sm text-muted-foreground uppercase tracking-wide mb-2">
        Application questions
      </h2>
      <ul className="space-y-1 mb-3 text-sm">
        {offering.applicationQuestions.map((q) => (
          <li
            key={q.id}
            className="bg-card border border-border rounded-md p-2 flex items-center justify-between"
          >
            <span>
              {q.prompt}{" "}
              {q.required ? (
                <span className="text-xs text-muted-foreground">(required)</span>
              ) : null}
            </span>
            <Form method="post">
              <input type="hidden" name="intent" value="removeQuestion" />
              <input type="hidden" name="questionId" value={q.id} />
              <button
                type="submit"
                className="text-xs text-red-600 hover:underline"
              >
                Delete
              </button>
            </Form>
          </li>
        ))}
      </ul>
      <Form method="post" className="flex items-end gap-2">
        <input type="hidden" name="intent" value="addQuestion" />
        <label className="block flex-1">
          <span className="text-xs font-medium text-muted-foreground">Add question</span>
          <input
            name="prompt"
            required
            className="mt-1 block w-full border border-border rounded-md px-2 py-1 text-sm"
          />
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" name="required" defaultChecked />
          Required
        </label>
        <button
          type="submit"
          disabled={nav.state !== "idle"}
          className="px-3 py-1.5 bg-accent-coral text-white text-sm font-medium rounded-md"
        >
          Add
        </button>
      </Form>

      <h2 className="font-heading font-bold text-sm text-muted-foreground uppercase tracking-wide mt-6 mb-2">
        Instructors
      </h2>
      <ul className="text-sm space-y-1">
        {offering.instructors.map((i) => (
          <li key={i.id}>
            {i.user.firstName} {i.user.lastName}{" "}
            <span className="text-muted-foreground text-xs">
              · {i.user.daliEmail ?? ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
