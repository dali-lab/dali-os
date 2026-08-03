import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/partner.home";
import { prisma } from "~/lib/db";
import { requirePartnerAccount } from "~/partners/lib/partner-auth.server";
import { partnerProjectsWhere } from "~/partners/lib/partner-access";
import { resolvePhotoUrl } from "~/lib/photo";
import { ProjectCoverImage } from "~/projects/components/ProjectCoverImage";
import {
  PARTNER_APPLICATION_STATUS_LABELS,
  PARTNER_APPLICATION_STATUS_PILL,
  type PartnerApplicationStatus,
} from "../lib/partner-application";

export const meta: Route.MetaFunction = () => [
  { title: "Partner Portal · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const { auth, partnerUser, org } = await requirePartnerAccount(request);

  // "Mine" = applications I submitted, plus (once I'm in an org) my org's.
  const applicationWhere = partnerUser
    ? {
        OR: [
          { applicantUserId: auth.user.sub },
          { partnerOrgId: partnerUser.partnerOrgId },
        ],
      }
    : { applicantUserId: auth.user.sub };

  const [applications, projects] = await Promise.all([
    prisma.partnerApplication.findMany({
      where: applicationWhere,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        resultingProjectId: true,
        sowSharedAt: true,
        contractSentAt: true,
        contractSignedAt: true,
      },
    }),
    // Applicants have no org, so no projects yet.
    partnerUser
      ? prisma.project.findMany({
          where: partnerProjectsWhere(partnerUser.partnerOrgId),
          orderBy: { name: "asc" },
          select: { id: true, name: true, description: true, imageUrl: true },
        })
      : [],
  ]);

  return {
    orgName: org?.name ?? null,
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

// The "how's my application going" lever: a plain next-step line so a partner
// who logs in knows where things stand without reading a board. A shared SOW is
// the most actionable state, so it takes precedence over the raw status.
function nextStep(
  status: PartnerApplicationStatus,
  sowShared: boolean,
  contractSent: boolean,
  contractSigned: boolean,
): string {
  const live = status !== "Accepted" && status !== "Rejected";
  if (contractSent && !contractSigned && live) {
    return "A contract is ready for your signature.";
  }
  if (sowShared && !contractSent && live) {
    return "A statement of work is ready for your feedback.";
  }
  switch (status) {
    case "Submitted":
      return "We've received your application — the team will review it soon.";
    case "UnderReview":
      return "The DALI team is reviewing your pitch. We may reach out to meet.";
    case "OnHold":
      return "On hold for now — we'll be in touch about timing.";
    case "Accepted":
      return "Accepted! We're setting up your project.";
    case "Rejected":
      return "Not something we can take on right now.";
  }
}

export default function PartnerHome() {
  const { orgName, firstName, applications, projects } =
    useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-heading text-3xl font-bold text-dark-blue">
          Welcome, {firstName || orgName || "there"}
        </h1>
        <p className="text-muted-foreground mt-1">
          {orgName
            ? "Your projects and applications with the DALI Lab."
            : "Track your application and pitch new projects to the DALI Lab."}
        </p>
      </div>

      {projects.length > 0 && (
        <section>
          <h2 className="font-heading text-lg font-semibold text-dark-blue mb-3">
            Your projects
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {projects.map((p) => (
              <Link
                key={p.id}
                to={`/partner/projects/${p.id}`}
                className="bg-card border border-border rounded-2xl overflow-hidden hover:border-accent-coral transition group"
              >
                <ProjectCoverImage
                  name={p.name}
                  imageUrl={p.imageUrl}
                  className="w-full h-32 object-cover"
                  placeholderClassName="w-full h-32"
                />
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
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-heading text-lg font-semibold text-dark-blue">
            {projects.length > 0 ? "Applications" : "Your application"}
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
              className="inline-block rounded-xl bg-dark-blue text-white font-heading font-semibold px-5 py-2.5 text-sm hover:opacity-90 transition"
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
                  <span className="text-xs text-muted-foreground block truncate">
                    {nextStep(
                      a.status,
                      a.sowSharedAt !== null,
                      a.contractSentAt !== null,
                      a.contractSignedAt !== null,
                    )}
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
