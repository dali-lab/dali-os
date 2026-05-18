import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/education.teaching";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const offerings = await prisma.educationOffering.findMany({
    where: { instructors: { some: { userId: auth.user.sub } } },
    orderBy: { startsAt: "desc" },
    include: {
      _count: {
        select: { applications: true, sessions: true },
      },
    },
  });
  return { offerings };
}

export default function Teaching() {
  const { offerings } = useLoaderData<typeof loader>();
  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-2xl font-bold text-dark-blue">Teaching</h1>
      </div>
      {offerings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          You aren't assigned as an instructor for any offering. Core can assign
          you from an offering's Settings tab.
        </p>
      ) : (
        <ul className="space-y-2">
          {offerings.map((o) => (
            <li
              key={o.id}
              className="bg-card border border-border rounded-md p-4 flex items-center justify-between"
            >
              <div>
                <Link
                  to={`/education/offerings/${o.id}`}
                  className="font-heading font-semibold text-dark-blue hover:underline"
                >
                  {o.title}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {o.type} · {o.status} · {o._count.applications} applications ·{" "}
                  {o._count.sessions} sessions
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
