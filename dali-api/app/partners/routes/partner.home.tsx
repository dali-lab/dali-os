import { Link, useLoaderData } from "react-router";
import { ArrowUpRight } from "lucide-react";
import type { Route } from "./+types/partner.home";
import { prisma } from "~/lib/db";
import { requirePartnerAccount } from "~/partners/lib/partner-auth.server";
import { partnerProjectsWhereForOrgs } from "~/partners/lib/partner-access";
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

// The DALI Lab's public partners page — linked from the portal home so a
// partner can read the full pitch/case studies without leaving to search.
const DALI_PARTNERS_URL = "https://dali.dartmouth.edu/partners";

export async function loader({ request }: Route.LoaderArgs) {
  const ctx = await requirePartnerAccount(request);
  const orgIds = ctx.memberships.map((m) => m.orgId);

  const [applications, projects] = await Promise.all([
    prisma.partnerApplication.findMany({
      where: { applicantContactId: ctx.contact.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        resultingProjectId: true,
      },
    }),
    // Skip the project query entirely when there are no org memberships yet
    // (fresh applicant). partnerProjectsWhereForOrgs([]) would return zero rows
    // anyway, but skipping avoids a vacuous DB round-trip.
    orgIds.length > 0
      ? prisma.project.findMany({
          where: partnerProjectsWhereForOrgs(orgIds),
          orderBy: { name: "asc" },
          select: { id: true, name: true, description: true, imageUrl: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    firstName: ctx.auth.user.firstName,
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

// Partner-safe journey: the ten internal funnel statuses collapse to five
// public milestones, each mapping to exactly one node so the track only ever
// moves forward. Internal triage granularity (Triaged/LearnMore/OnHold) stays
// hidden.
const TRACK = [
  "Submitted",
  "Meeting",
  "Under review",
  "Decision",
  "Project",
] as const;
const DECISION_NODE = 3;

function trackIndex(status: PartnerApplicationStatus): number {
  switch (status) {
    case "Inquiry":
    case "Triaged":
      return 0;
    case "Meeting":
      return 1;
    case "ApplicationSubmitted":
    case "UnderReview":
    case "LearnMore":
    case "OnHold":
    case "Submitted":
      return 2;
    case "Accepted":
    case "Rejected":
      return 3;
    case "Promoted":
      return 4;
    default:
      return 0;
  }
}

function statusHint(status: PartnerApplicationStatus): string {
  switch (status) {
    case "Inquiry":
    case "Triaged":
      return "We've received your pitch and will be in touch to schedule a meeting.";
    case "Meeting":
      return "A meeting with the DALI team is being arranged.";
    case "ApplicationSubmitted":
    case "UnderReview":
    case "Submitted":
      return "The DALI team is reviewing your pitch.";
    case "LearnMore":
      return "The DALI team has a few follow-up questions for you.";
    case "OnHold":
      return "Your pitch is on hold for now — we'll follow up.";
    case "Accepted":
      return "Accepted! We'll draft a statement of work together.";
    case "Rejected":
      return "Not selected this cycle. Thank you for pitching.";
    case "Promoted":
      return "Your project is live — see it under Projects.";
    default:
      return "";
  }
}

function ProgressTrack({ status }: { status: PartnerApplicationStatus }) {
  const current = trackIndex(status);
  const declined = status === "Rejected";
  return (
    <ol className="flex" aria-label="Application progress">
      {TRACK.map((label, i) => {
        const done = i < current;
        const isCurrent = i === current;
        const declinedNode = declined && i === DECISION_NODE;
        const last = i === TRACK.length - 1;
        return (
          <li
            key={label}
            className="relative flex flex-1 flex-col items-center text-center"
          >
            {!last && (
              <span
                className={`absolute left-1/2 top-[7px] h-0.5 w-full ${
                  done ? "bg-accent-teal" : "bg-border"
                }`}
              />
            )}
            <span
              className={`relative z-10 h-3.5 w-3.5 rounded-full border-2 ${
                declinedNode
                  ? "border-destructive bg-destructive"
                  : done || isCurrent
                    ? "border-accent-teal bg-accent-teal"
                    : "border-border bg-card"
              } ${isCurrent && !declinedNode ? "ring-2 ring-accent-teal/30" : ""}`}
            />
            <span
              className={`mt-2 text-[11px] leading-tight ${
                done || isCurrent ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

type AppRow = {
  id: string;
  title: string;
  status: PartnerApplicationStatus;
  createdAt: string | Date;
};

function ApplicationCard({ app }: { app: AppRow }) {
  return (
    <Link
      to={`/partner/applications/${app.id}`}
      className="block bg-card border border-border rounded-2xl p-4 hover:border-accent-coral transition"
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <span className="text-sm font-medium text-foreground block truncate">
            {app.title}
          </span>
          <span className="text-xs text-muted-foreground">
            Submitted{" "}
            {new Date(app.createdAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>
        <span
          className={`text-xs rounded-full px-2 py-0.5 flex-shrink-0 ${PARTNER_APPLICATION_STATUS_PILL[app.status]}`}
        >
          {PARTNER_APPLICATION_STATUS_LABELS[app.status]}
        </span>
      </div>
      <ProgressTrack status={app.status} />
      <p className="mt-4 text-xs text-muted-foreground">
        {statusHint(app.status)}
      </p>
    </Link>
  );
}

const STEPS = [
  { n: 1, title: "Pitch your idea", desc: "Tell us what you want to build." },
  { n: 2, title: "We meet", desc: "Talk through scope and fit with the team." },
  {
    n: 3,
    title: "Team gets staffed",
    desc: "We assemble a student project team.",
  },
  {
    n: 4,
    title: "Build together",
    desc: "Design and development across the term.",
  },
];

function HowItWorks() {
  return (
    <section>
      <h2 className="font-heading text-lg font-semibold text-dark-blue mb-4">
        How it works
      </h2>
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s) => (
          <li key={s.n} className="bg-card border border-border rounded-2xl p-5">
            <span className="flex items-center justify-center h-8 w-8 rounded-full bg-accent-coral/15 text-accent-coral font-heading font-bold text-sm">
              {s.n}
            </span>
            <p className="mt-3 font-heading font-semibold text-dark-blue">
              {s.title}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{s.desc}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function LearnMoreLink({ muted }: { muted?: boolean }) {
  return (
    <a
      href={DALI_PARTNERS_URL}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-1 text-sm font-medium transition ${
        muted
          ? "text-muted-foreground hover:text-accent-coral"
          : "text-accent-coral hover:underline"
      }`}
    >
      Learn more about partnering with DALI
      <ArrowUpRight className="w-3.5 h-3.5" />
    </a>
  );
}

export default function PartnerHome() {
  const { firstName, applications, projects } = useLoaderData<typeof loader>();
  const hasProjects = projects.length > 0;
  const hasApplications = applications.length > 0;
  const isFresh = !hasProjects && !hasApplications;

  return (
    <div className="flex flex-col gap-8 max-w-5xl">
      <div>
        <h1 className="font-heading text-3xl font-bold text-dark-blue">
          Welcome{firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="text-muted-foreground mt-1">
          Your projects and applications with the DALI Lab.
        </p>
      </div>

      {isFresh && (
        <section className="bg-card border border-border rounded-2xl p-8 sm:p-10 flex flex-col items-center text-center">
          <h2 className="font-heading text-2xl font-bold text-dark-blue">
            Have an idea?
          </h2>
          <p className="text-muted-foreground mt-2 max-w-md">
            Partner with the DALI Lab to design and build software with a student
            team. Pitch a project and we'll take it from there.
          </p>
          <Link
            to="/partner/apply"
            className="mt-6 inline-block rounded-xl bg-dark-blue text-white font-heading font-semibold px-6 py-3 text-sm hover:opacity-90 transition"
          >
            Pitch a project
          </Link>
          <div className="mt-4">
            <LearnMoreLink />
          </div>
        </section>
      )}

      {hasProjects && (
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

      {hasApplications && (
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
          <div className="grid gap-4">
            {applications.map((a) => (
              <ApplicationCard key={a.id} app={a} />
            ))}
          </div>
          {!hasProjects && (
            <p className="text-xs text-muted-foreground mt-3">
              Once an application is accepted and a team is staffed, your project
              will appear here.
            </p>
          )}
        </section>
      )}

      {/* Orientation for anyone without a live project (fresh or applicant). */}
      {!hasProjects && <HowItWorks />}

      {/* The fresh hero already carries the learn-more link; other states get
          it as a subtle footer. */}
      {!isFresh && (
        <div className="pt-2">
          <LearnMoreLink muted />
        </div>
      )}
    </div>
  );
}
