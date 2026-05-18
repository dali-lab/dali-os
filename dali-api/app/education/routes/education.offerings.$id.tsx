import { useLoaderData } from "react-router";
import type { Route } from "./+types/education.offerings.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { EducationTabs } from "~/education/components/EducationTabs";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const offering = await prisma.educationOffering.findUnique({
    where: { id: params.id },
    include: {
      instructors: {
        include: { user: { select: { firstName: true, lastName: true } } },
      },
      sessions: { orderBy: { sequence: "asc" } },
      _count: { select: { applications: true } },
    },
  });
  if (!offering) {
    return new Response("Not found", { status: 404 });
  }
  return { offering };
}

export default function OfferingOverview() {
  const { offering } = useLoaderData<typeof loader>();
  return (
    <div className="max-w-5xl mx-auto p-6">
      <EducationTabs offeringId={offering.id} offeringTitle={offering.title} />
      <dl className="grid grid-cols-2 gap-4 text-sm mb-6">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Type</dt>
          <dd>{offering.type}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Status</dt>
          <dd>{offering.status}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Capacity</dt>
          <dd>{offering._count.applications}/{offering.capacity} (incl. waitlist)</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Instructors</dt>
          <dd>
            {offering.instructors
              .map((i) => `${i.user.firstName} ${i.user.lastName}`.trim())
              .filter(Boolean)
              .join(", ") || "—"}
          </dd>
        </div>
      </dl>
      <section className="bg-card border border-border rounded-md p-4">
        <h2 className="font-heading font-semibold text-base text-dark-blue mb-3">
          Sessions
        </h2>
        {offering.sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sessions scheduled yet.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {offering.sessions.map((s) => (
              <li key={s.id} className="flex justify-between">
                <span>
                  #{s.sequence} ·{" "}
                  {new Date(s.datetime).toLocaleString()}
                </span>
                <span className="text-muted-foreground">{s.location ?? "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
