import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/education.browse";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const offerings = await prisma.educationOffering.findMany({
    where: { status: "Published" },
    orderBy: { startsAt: "asc" },
    include: {
      instructors: {
        include: {
          user: { select: { firstName: true, lastName: true } },
        },
      },
      _count: { select: { applications: true } },
    },
  });

  return { offerings };
}

export default function EducationBrowse() {
  const { offerings } = useLoaderData<typeof loader>();
  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="font-heading text-2xl font-bold text-dark-blue mb-1">
        Browse Education
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        Miniseries and workshops open for registration.
      </p>
      {offerings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No published offerings right now. Check back later.
        </p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {offerings.map((o) => (
            <li key={o.id} className="bg-card rounded-md border border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-heading font-semibold text-base text-dark-blue">
                  <Link to={`/education/offerings/${o.id}`} className="hover:underline">
                    {o.title}
                  </Link>
                </h2>
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {o.type}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {o.instructors
                  .map((i) => `${i.user.firstName} ${i.user.lastName}`.trim())
                  .filter(Boolean)
                  .join(", ") || "TBD"}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Starts {new Date(o.startsAt).toLocaleDateString()} ·{" "}
                {o._count.applications}/{o.capacity} registered
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
