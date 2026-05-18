import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/portal.education._index";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const offerings = await prisma.educationOffering.findMany({
    where: { status: "Published" },
    orderBy: { startsAt: "asc" },
    include: { _count: { select: { applications: true } } },
  });
  return { offerings };
}

export default function PortalCatalog() {
  const { offerings } = useLoaderData<typeof loader>();
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="font-heading text-2xl font-bold text-dark-blue mb-1">
        DALI Education
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        Apply for miniseries or RSVP to workshops open to the Dartmouth community.
      </p>
      {offerings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No published offerings right now.
        </p>
      ) : (
        <ul className="space-y-3">
          {offerings.map((o) => (
            <li
              key={o.id}
              className="bg-card border border-border rounded-md p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-heading font-semibold text-base text-dark-blue">
                  <Link
                    to={`/portal/education/${o.id}`}
                    className="hover:underline"
                  >
                    {o.title}
                  </Link>
                </h2>
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {o.type}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
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
