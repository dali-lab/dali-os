import { useLoaderData, Link, Form, useNavigation } from "react-router";
import type { Route } from "./+types/portal.education.$offeringId";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { apply } from "~/lib/education/apply";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const [offering, application] = await Promise.all([
    prisma.educationOffering.findUnique({
      where: { id: params.offeringId },
      include: {
        sessions: { orderBy: { sequence: "asc" } },
        applicationQuestions: { orderBy: { position: "asc" } },
        _count: { select: { applications: true } },
        instructors: {
          include: {
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
    }),
    prisma.educationApplication.findUnique({
      where: {
        applicantUserId_offeringId: {
          applicantUserId: auth.user.sub,
          offeringId: params.offeringId!,
        },
      },
    }),
  ]);
  if (!offering || offering.status !== "Published") {
    return new Response("Not found", { status: 404 });
  }
  return { offering, application };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const fd = await request.formData();
  const answers: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("answer:")) answers[k.slice("answer:".length)] = String(v);
  }
  const outcome = await apply({
    offeringId: params.offeringId!,
    applicantUserId: auth.user.sub,
    answers,
  });
  if (!outcome.ok) {
    return { error: outcome.error };
  }
  return { result: outcome.result };
}

export default function PortalOfferingDetail() {
  const { offering, application } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  const closed = new Date() > new Date(offering.registrationClosesAt);
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <p className="text-xs text-muted-foreground mb-1">
        <Link to="/portal/education" className="hover:underline">
          ← Back to catalog
        </Link>
      </p>
      <h1 className="font-heading text-2xl font-bold text-dark-blue mb-2">
        {offering.title}
      </h1>
      <p className="text-sm text-muted-foreground mb-4">
        {offering.type} ·{" "}
        {offering.instructors
          .map((i) => `${i.user.firstName} ${i.user.lastName}`.trim())
          .filter(Boolean)
          .join(", ") || "TBD"}{" "}
        · {offering._count.applications}/{offering.capacity} registered
      </p>

      <section className="bg-card border border-border rounded-md p-4 mb-4">
        <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-muted-foreground mb-2">
          Sessions
        </h2>
        {offering.sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">TBD</p>
        ) : (
          <ul className="text-sm space-y-1">
            {offering.sessions.map((s) => (
              <li key={s.id}>
                #{s.sequence} · {new Date(s.datetime).toLocaleString()}
                {s.location ? ` · ${s.location}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      {application && application.status !== "Withdrawn" && application.status !== "Rejected" ? (
        <div className="bg-card border border-border rounded-md p-4">
          <p className="text-sm">
            Your status:{" "}
            <span className="font-semibold">{application.status}</span>
          </p>
          <Link
            to={`/portal/education/applications/${application.id}`}
            className="text-xs text-accent-coral hover:underline"
          >
            View application →
          </Link>
        </div>
      ) : closed ? (
        <p className="text-sm text-muted-foreground">Registration is closed.</p>
      ) : (
        <Form
          method="post"
          className="bg-card border border-border rounded-md p-4 space-y-3"
        >
          <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-muted-foreground">
            {offering.requiresReview ? "Apply" : "RSVP"}
          </h2>
          {offering.applicationQuestions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No application questions — just confirm to register.
            </p>
          ) : (
            offering.applicationQuestions.map((q) => (
              <label key={q.id} className="block">
                <span className="text-sm font-medium text-dark-blue">
                  {q.prompt}
                  {q.required && <span className="text-red-600"> *</span>}
                </span>
                <textarea
                  name={`answer:${q.id}`}
                  required={q.required}
                  rows={3}
                  className="mt-1 block w-full border border-border rounded-md px-2 py-1 text-sm"
                />
              </label>
            ))
          )}
          <button
            type="submit"
            disabled={nav.state !== "idle"}
            className="px-4 py-2 bg-accent-coral text-white text-sm font-medium rounded-md"
          >
            {offering.requiresReview ? "Submit application" : "Confirm RSVP"}
          </button>
        </Form>
      )}
    </div>
  );
}
