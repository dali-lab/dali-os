import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/education.manage.$id";
import { requireAuth } from "~/lib/auth";
import { canManageOffering } from "~/education/lib/auth";
import { getOfferingDetail } from "~/education/lib/offerings-data";
import { listTemplates } from "~/education/lib/templates-data";
import { prisma } from "~/lib/db";
import { OfferingBuilder } from "~/education/components/OfferingBuilder";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data && "offering" in data ? `Edit ${(data as any).offering.title} · Education` : "Edit offering" },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await canManageOffering(auth.user.sub, params.id))) {
    throw new Response("Forbidden", { status: 403 });
  }

  const offering = await getOfferingDetail(params.id);
  if (!offering) throw new Response("Not found", { status: 404 });

  const [templates, emailTemplates, decisionEmailBindings] = await Promise.all([
    listTemplates(),
    // All EmailTemplate + their latest version so the builder can show a picker.
    prisma.emailTemplate.findMany({
      orderBy: { name: "asc" },
      include: {
        versions: { orderBy: { versionNumber: "desc" }, take: 1 },
      },
    }),
    prisma.offeringDecisionEmail.findMany({ where: { offeringId: params.id } }),
  ]);

  return {
    offering: {
      id: offering.id,
      title: offering.title,
      type: offering.type,
      status: offering.status,
      capacity: offering.capacity,
      registrationOpensAt: offering.registrationOpensAt.toISOString(),
      registrationClosesAt: offering.registrationClosesAt.toISOString(),
      startsAt: offering.startsAt.toISOString(),
      endsAt: offering.endsAt.toISOString(),
      requiresReview: offering.requiresReview,
    },
    sessions: offering.sessions.map((s) => ({
      id: s.id,
      sequence: s.sequence,
      datetime: s.datetime.toISOString(),
      location: s.location,
    })),
    questions: offering.applicationQuestions.map((q) => ({
      id: q.id,
      prompt: q.prompt,
      required: q.required,
      position: q.position,
    })),
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      questionCount: t._count.questions,
    })),
    emailTemplates: emailTemplates
      .filter((t) => t.versions[0])
      .map((t) => ({
        id: t.id,
        name: t.name,
        latestVersionId: t.versions[0]!.id,
      })),
    decisionEmailBindings: decisionEmailBindings.map((b) => ({
      status: b.status,
      emailTemplateVersionId: b.emailTemplateVersionId,
    })),
  };
}

export default function EditOffering() {
  const data = useLoaderData<typeof loader>();
  return (
    <div className="p-6 md:p-10">
      <div className="max-w-3xl mx-auto mb-4 flex items-center gap-3">
        <Link to="/education/manage" className="text-xs text-muted-foreground hover:underline">
          ← All offerings
        </Link>
        <Link
          to={`/education/manage/${data.offering.id}/applications`}
          className="ml-auto text-xs text-accent-coral hover:underline"
        >
          Review applications →
        </Link>
        <Link
          to={`/education/manage/${data.offering.id}/assignments`}
          className="text-xs text-accent-coral hover:underline"
        >
          Assignments →
        </Link>
        <Link
          to={`/education/enrolled/${data.offering.id}`}
          className="text-xs text-muted-foreground hover:underline"
        >
          Preview enrolled view
        </Link>
      </div>
      <OfferingBuilder
        offering={data.offering}
        sessions={data.sessions}
        questions={data.questions}
        templates={data.templates}
        emailTemplates={data.emailTemplates}
        decisionEmailBindings={data.decisionEmailBindings as any}
      />
    </div>
  );
}
