import { useLoaderData, Link, Form, useNavigation } from "react-router";
import type { Route } from "./+types/portal.education.applications.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { decide } from "~/lib/education/decisions";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const application = await prisma.educationApplication.findUnique({
    where: { id: params.id },
    include: {
      offering: {
        include: {
          sessions: { orderBy: { sequence: "asc" } },
          assignments: { orderBy: { dueAt: "asc" } },
          announcements: { orderBy: { sentAt: "desc" }, take: 10 },
        },
      },
    },
  });
  if (!application || application.applicantUserId !== auth.user.sub) {
    return new Response("Not found", { status: 404 });
  }
  return { application };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const application = await prisma.educationApplication.findUnique({
    where: { id: params.id },
    select: { applicantUserId: true },
  });
  if (!application || application.applicantUserId !== auth.user.sub) {
    return new Response("Not found", { status: 404 });
  }
  await decide({
    applicationId: params.id!,
    action: "Withdraw",
    actorUserId: auth.user.sub,
  });
  return null;
}

export default function PortalApplicationDetail() {
  const { application } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const isApproved = application.status === "Approved";
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <p className="text-xs text-muted-foreground mb-1">
        <Link to="/portal/education" className="hover:underline">
          ← Back to catalog
        </Link>
      </p>
      <h1 className="font-heading text-2xl font-bold text-dark-blue mb-1">
        {application.offering.title}
      </h1>
      <p className="text-sm mb-4">
        Status: <span className="font-semibold">{application.status}</span>
      </p>

      {isApproved && (
        <>
          <section className="bg-card border border-border rounded-md p-4 mb-4">
            <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-muted-foreground mb-2">
              Sessions
            </h2>
            {application.offering.sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">TBD</p>
            ) : (
              <ul className="text-sm space-y-1">
                {application.offering.sessions.map((s) => (
                  <li key={s.id}>
                    #{s.sequence} · {new Date(s.datetime).toLocaleString()}
                    {s.location ? ` · ${s.location}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bg-card border border-border rounded-md p-4 mb-4">
            <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-muted-foreground mb-2">
              Assignments
            </h2>
            {application.offering.assignments.length === 0 ? (
              <p className="text-sm text-muted-foreground">None yet.</p>
            ) : (
              <ul className="text-sm space-y-1">
                {application.offering.assignments.map((a) => (
                  <li key={a.id}>
                    <Link
                      to={`/portal/education/applications/${application.id}/assignments/${a.id}`}
                      className="text-dark-blue hover:underline"
                    >
                      {a.title}
                    </Link>
                    {a.dueAt && (
                      <span className="text-xs text-muted-foreground">
                        {" "}· due {new Date(a.dueAt).toLocaleDateString()}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bg-card border border-border rounded-md p-4 mb-4">
            <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-muted-foreground mb-2">
              Announcements
            </h2>
            {application.offering.announcements.length === 0 ? (
              <p className="text-sm text-muted-foreground">No announcements yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {application.offering.announcements.map((a) => (
                  <li key={a.id}>
                    <p className="text-xs text-muted-foreground">
                      {new Date(a.sentAt).toLocaleString()}
                    </p>
                    <p className="whitespace-pre-wrap">{a.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {application.status !== "Withdrawn" && application.status !== "Rejected" && (
        <Form method="post">
          <button
            type="submit"
            disabled={nav.state !== "idle"}
            className="text-sm text-red-600 hover:underline"
            onClick={(e) => {
              if (!confirm("Withdraw this application?")) e.preventDefault();
            }}
          >
            Withdraw
          </button>
        </Form>
      )}
    </div>
  );
}
