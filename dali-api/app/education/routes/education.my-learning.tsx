import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/education.my-learning";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const applications = await prisma.educationApplication.findMany({
    where: { applicantUserId: auth.user.sub },
    orderBy: { submittedAt: "desc" },
    include: {
      offering: { select: { id: true, title: true, startsAt: true, type: true } },
    },
  });
  return { applications };
}

const STATUS_CLASSES: Record<string, string> = {
  Approved: "bg-green-50 text-green-700",
  Submitted: "bg-blue-50 text-blue-700",
  Waitlisted: "bg-amber-50 text-amber-700",
  Rejected: "bg-red-50 text-red-700",
  Withdrawn: "bg-gray-100 text-gray-600",
};

export default function MyLearning() {
  const { applications } = useLoaderData<typeof loader>();
  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="font-heading text-2xl font-bold text-dark-blue mb-6">
        My Learning
      </h1>
      {applications.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          You haven't applied to anything yet.{" "}
          <Link to="/education/browse" className="text-accent-coral hover:underline">
            Browse the catalog
          </Link>
          .
        </p>
      ) : (
        <ul className="space-y-2">
          {applications.map((a) => (
            <li
              key={a.id}
              className="bg-card border border-border rounded-md p-4 flex items-center justify-between gap-4"
            >
              <div>
                <Link
                  to={`/portal/education/applications/${a.id}`}
                  className="font-heading font-semibold text-dark-blue hover:underline"
                >
                  {a.offering.title}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {a.offering.type} · starts{" "}
                  {new Date(a.offering.startsAt).toLocaleDateString()}
                </p>
              </div>
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded ${
                  STATUS_CLASSES[a.status] ?? "bg-gray-100 text-gray-600"
                }`}
              >
                {a.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
