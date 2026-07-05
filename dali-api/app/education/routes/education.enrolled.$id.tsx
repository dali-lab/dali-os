import { Outlet, useLoaderData } from "react-router";
import type { Route } from "./+types/education.enrolled.$id";
import { requireEnrollment } from "~/education/lib/auth";
import { prisma } from "~/lib/db";
import { EnrolledSubNav } from "~/education/components/EnrolledSubNav";

export const handle = {
  breadcrumb: (data: any) => data?.offering?.title ?? "Enrolled",
};

export const meta: Route.MetaFunction = ({ data }) => [
  {
    title:
      data?.offering?.title
        ? `${data.offering.title} · Enrolled`
        : "Enrolled · Education",
  },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const { application, isManager } = await requireEnrollment(request, params.id);

  const offering = await prisma.educationOffering.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      title: true,
      type: true,
      startsAt: true,
      endsAt: true,
      sessions: { orderBy: { sequence: "asc" }, take: 1, select: { location: true } },
      instructors: { include: { user: { select: { firstName: true, lastName: true } } } },
    },
  });
  if (!offering) throw new Response("Not found", { status: 404 });

  return {
    offering: {
      id: offering.id,
      title: offering.title,
      type: offering.type,
      startsAt: offering.startsAt.toISOString(),
      endsAt: offering.endsAt.toISOString(),
      location: offering.sessions[0]?.location ?? null,
      instructors: offering.instructors,
    },
    applicationId: application?.id ?? null,
    isManager,
  };
}

export default function EnrolledLayout() {
  const { offering, isManager } = useLoaderData<typeof loader>();
  return (
    <div className="flex flex-col">
      {isManager && (
        <div className="px-6 pt-4">
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
            Previewing — you are viewing this as an instructor/Core member.
          </div>
        </div>
      )}
      <header className="px-6 md:px-10 py-5 border-b border-border">
        <p className="text-xs uppercase tracking-wider text-accent-teal mb-1">{offering.type}</p>
        <h1 className="font-heading text-2xl font-bold text-dark-blue">{offering.title}</h1>
        <p className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-x-2">
          <span>
            {new Date(offering.startsAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
            {" – "}
            {new Date(offering.endsAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
          {offering.location && <span>· {offering.location}</span>}
          {offering.instructors.length > 0 && (
            <span>
              {"· "}
              {offering.instructors
                .map((i: any) =>
                  `${i.user.firstName ?? ""} ${i.user.lastName ?? ""}`.trim(),
                )
                .filter(Boolean)
                .join(", ")}
            </span>
          )}
        </p>
      </header>
      <div className="flex flex-col md:flex-row">
        <EnrolledSubNav />
        <main className="flex-1 min-w-0 p-6 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
