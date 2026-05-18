import { useLoaderData, Form, useNavigation } from "react-router";
import type { Route } from "./+types/education.offerings.$id.sessions";
import { prisma } from "~/lib/db";
import { requireEducationManager } from "~/education/lib/access";
import { syncSessionRoster } from "~/lib/education/roster-sync";
import { EducationTabs } from "~/education/components/EducationTabs";

export async function loader({ request, params }: Route.LoaderArgs) {
  const gate = await requireEducationManager(request, params.id);
  if (!gate.ok) return gate.response;
  const offering = await prisma.educationOffering.findUnique({
    where: { id: params.id },
    select: { id: true, title: true },
  });
  if (!offering) return new Response("Not found", { status: 404 });
  const sessions = await prisma.educationSession.findMany({
    where: { offeringId: params.id },
    orderBy: { sequence: "asc" },
  });
  return { offering, sessions };
}

export async function action({ request, params }: Route.ActionArgs) {
  const gate = await requireEducationManager(request, params.id);
  if (!gate.ok) return gate.response;
  const fd = await request.formData();
  const intent = String(fd.get("intent") || "create");
  if (intent === "delete") {
    await prisma.educationSession.delete({
      where: { id: String(fd.get("sessionId")) },
    });
    return null;
  }
  const datetime = String(fd.get("datetime") || "");
  const location = String(fd.get("location") || "") || null;
  if (!datetime) return { error: "datetime required" };
  const max = await prisma.educationSession.aggregate({
    where: { offeringId: params.id! },
    _max: { sequence: true },
  });
  await prisma.educationSession.create({
    data: {
      offeringId: params.id!,
      sequence: (max._max.sequence ?? 0) + 1,
      datetime: new Date(datetime),
      location,
    },
  });
  syncSessionRoster(params.id!).catch(() => {});
  return null;
}

export default function Sessions() {
  const { offering, sessions } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  return (
    <div className="max-w-5xl mx-auto p-6">
      <EducationTabs offeringId={offering.id} offeringTitle={offering.title} />
      <Form method="post" className="flex items-end gap-3 bg-card border border-border rounded-md p-3 mb-4">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">When</span>
          <input
            type="datetime-local"
            name="datetime"
            required
            className="block border border-border rounded-md px-2 py-1 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Location</span>
          <input
            name="location"
            placeholder="DALI Lab — Pod Appa"
            className="block border border-border rounded-md px-2 py-1 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={nav.state !== "idle"}
          className="px-3 py-1.5 bg-accent-coral text-white text-sm font-medium rounded-md"
        >
          Add session
        </button>
      </Form>
      <ul className="space-y-2">
        {sessions.map((s) => (
          <li key={s.id} className="bg-card border border-border rounded-md p-3 flex items-center justify-between text-sm">
            <span>
              <span className="font-semibold">#{s.sequence}</span> ·{" "}
              {new Date(s.datetime).toLocaleString()} ·{" "}
              <span className="text-muted-foreground">{s.location ?? "—"}</span>
            </span>
            <Form method="post">
              <input type="hidden" name="intent" value="delete" />
              <input type="hidden" name="sessionId" value={s.id} />
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
    </div>
  );
}
