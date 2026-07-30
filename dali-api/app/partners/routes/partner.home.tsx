import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/partner.home";
import { prisma } from "~/lib/db";
import { requirePartner } from "~/partners/lib/partner-auth.server";
import { partnerProjectsWhere } from "~/partners/lib/partner-access";
import { resolvePhotoUrl } from "~/lib/photo";
import {
  PARTNER_APPLICATION_STATUS_LABELS,
  PARTNER_APPLICATION_STATUS_PILL,
} from "../lib/partner-application";

export const meta: Route.MetaFunction = () => [
  { title: "Partner Portal · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const { auth, partnerUser, org } = await requirePartner(request);

  const [applications, projects] = await Promise.all([
    prisma.partnerApplication.findMany({
      where: { partnerOrgId: partnerUser.partnerOrgId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        resultingProjectId: true,
      },
    }),
    prisma.project.findMany({
      where: partnerProjectsWhere(partnerUser.partnerOrgId),
      orderBy: { name: "asc" },
      select: { id: true, name: true, description: true, imageUrl: true },
    }),
  ]);

  return {
    org,
    firstName: auth.user.firstName,
    applications,
    projects: await Promise.all(
      projects.map(async (p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        imageUrl: await resolvePhotoUrl(p.imageUrl),
      })),
    ),
  };
}

export default function PartnerHome() {
  const { org, firstName, applications, projects } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-heading text-3xl font-bold text-dark-blue">
          {/* Greet the person — the org name already sits in the nav chip. */}
          Welcome, {firstName || org.name}
        </h1>
        <p className="text-muted-foreground mt-1">
          Your projects and applications with the DALI Lab.
        </p>
      </div>

      <section>
        <h2 className="font-heading text-lg font-semibold text-dark-blue mb-3">
          Your projects
        </h2>
        {projects.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No active projects yet. Once an application is accepted and a
              team is staffed, your project will appear here.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {projects.map((p) => (
              <Link
                key={p.id}
                to={`/partner/projects/${p.id}`}
                className="bg-card border border-border rounded-2xl overflow-hidden hover:border-accent-coral transition group"
              >
                {p.imageUrl && (
                  <img
                    src={p.imageUrl}
                    alt=""
                    className="w-full h-32 object-cover"
                  />
                )}
                <div className="p-4">
                  <span className="font-heading font-semibold text-dark-blue group-hover:text-accent-coral transition">
                    {p.name}
                  </span>
                  {p.description && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {p.description}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-heading text-lg font-semibold text-dark-blue">
            Applications
          </h2>
          <Link
            to="/partner/apply"
            className="text-sm font-medium text-accent-coral hover:underline"
          >
            + Pitch a project
          </Link>
        </div>
        {applications.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-8 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              No applications yet — tell us what you'd like to build together.
            </p>
            <Link
              to="/partner/apply"
              className="inline-block rounded-xl bg-accent-coral text-white font-heading font-semibold px-5 py-2.5 text-sm hover:bg-accent-coral/90 transition"
            >
              Pitch a project
            </Link>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-2xl divide-y divide-border">
            {applications.map((a) => (
              <Link
                key={a.id}
                to={`/partner/applications/${a.id}`}
                className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/20 transition"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground block truncate">
                    {a.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Submitted{" "}
                    {new Date(a.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
                <span
                  className={`text-xs rounded-full px-2 py-0.5 flex-shrink-0 ${PARTNER_APPLICATION_STATUS_PILL[a.status]}`}
                >
                  {PARTNER_APPLICATION_STATUS_LABELS[a.status]}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
