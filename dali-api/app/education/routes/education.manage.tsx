import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/education.manage";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) {
    return new Response("Forbidden", { status: 403 });
  }
  const offerings = await prisma.educationOffering.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { applications: true, sessions: true } },
    },
  });
  return { offerings };
}

export default function Manage() {
  const { offerings } = useLoaderData<typeof loader>();
  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-heading text-2xl font-bold text-dark-blue">
          Manage Offerings
        </h1>
        <Link
          to="/education/offerings/new"
          className="px-3 py-2 bg-accent-coral text-white text-sm font-medium rounded-md hover:opacity-90"
        >
          + New Offering
        </Link>
      </div>
      {offerings.length === 0 ? (
        <p className="text-sm text-muted-foreground">No offerings yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left py-2">Title</th>
              <th className="text-left">Type</th>
              <th className="text-left">Status</th>
              <th className="text-right">Roster</th>
              <th className="text-right">Sessions</th>
            </tr>
          </thead>
          <tbody>
            {offerings.map((o) => (
              <tr key={o.id} className="border-t border-border">
                <td className="py-2">
                  <Link
                    to={`/education/offerings/${o.id}`}
                    className="text-dark-blue hover:underline font-medium"
                  >
                    {o.title}
                  </Link>
                </td>
                <td>{o.type}</td>
                <td>{o.status}</td>
                <td className="text-right">
                  {o._count.applications}/{o.capacity}
                </td>
                <td className="text-right">{o._count.sessions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
