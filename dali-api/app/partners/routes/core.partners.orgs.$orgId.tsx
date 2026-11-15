import { loadPartnerOrgDetail } from "../lib/org-detail.server";
import { SettingsTab } from "../components/org/SettingsTab";
import { ContactsTab } from "../components/org/ContactsTab";
import { ProjectsTab } from "../components/org/ProjectsTab";
import {
  ORG_TAB_LABELS,
  ORG_TAB_VALUES,
  isOrgTab,
  type OrgTab,
} from "../components/org/org-tabs";
import { runPartnerOrgAction } from "../lib/org-actions.server";
import { Link, useActionData, useLoaderData, useSearchParams } from "react-router";
import { Pencil } from "lucide-react";
import { useOsChrome } from "~/components/os-chrome";
import { OsTabBar } from "~/components/os-page";
import type { Route } from "./+types/core.partners.orgs.$orgId";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { coreHandle } from "~/core/coreNav";
import { relativeTime } from "~/lib/relative-time";
import { formatUsd } from "~/lib/money";
import { PROJECT_FUNDING_TYPE_LABELS } from "~/lib/chart-string";
import { PartnerActivityFeed } from "../components/PartnerActivityFeed";
import { OrgAvatar } from "../components/org/OrgAvatar";
import {
  DotPill,
  OrgStatusPill,
  OrgTypePill,
  PartnerStagePill,
} from "../components/org/OrgStatusPill";
import { InvoicesPanel } from "../components/org/InvoicesPanel";
import { type PartnerRelationshipStatus } from "../lib/partner-org";

export const meta: Route.MetaFunction = ({ data }) => {
  const name = (data as { org?: { name: string } } | undefined)?.org?.name;
  return [{ title: name ? `${name} · DALI OS` : "Organization · DALI OS" }];
};

// The trailing crumb reads the org name off `trailLabel`, set below, so the
// trail is "Core › Partner CRM › <org name>".
export const handle = {
  ...coreHandle("partners", (data) => (data as { trailLabel?: string } | null)?.trailLabel),
  favoriteRoute: true,
};

export async function loader({ request, params }: Route.LoaderArgs) {
  return loadPartnerOrgDetail(request, params.orgId);
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) {
    return { error: "You don't have permission to edit organizations." };
  }
  const org = await prisma.partnerOrg.findUnique({
    where: { id: params.orgId },
    select: { id: true, name: true, primaryContactId: true, isIndividual: true },
  });
  if (!org) throw new Response("Not found", { status: 404 });

  const form = await request.formData();
  const intent = form.get("intent") as string;
  return runPartnerOrgAction(
    {
      form,
      org,
      userId: auth.user.sub,
      request,
      actor: { actorUserId: auth.user.sub, request },
    },
    intent,
  );
}

export type PartnerOrgLoaderData = ReturnType<typeof useLoaderData<typeof loader>>;

export default function PartnerOrgDetail() {
  const {
    org,
    status,
    pendingInvites,
    linkableProjects,
    otherOrgs,
    allContacts,
    activities,
    activitiesNextCursor,
    actorNames,
    chartStrings,
    canDeleteOrg,
    canEdit,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const os = useOsChrome();
  const [searchParams, setSearchParams] = useSearchParams();

  const error = actionData && "error" in actionData ? actionData.error : null;

  const tabParam = searchParams.get("tab");
  const tab: OrgTab = isOrgTab(tabParam) ? tabParam : "timeline";
  const setTab = (next: OrgTab) =>
    setSearchParams(
      (prev) => {
        prev.set("tab", next);
        return prev;
      },
      { replace: true, preventScrollReset: true },
    );

  const websiteHost = org.website?.replace(/^https?:\/\//, "").replace(/\/$/, "");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-6">
        <OrgAvatar org={org} size="lg" />
        <div className="min-w-0 flex flex-1 flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex flex-col gap-1">
              <h1 className="font-heading text-[32px] font-medium leading-none text-foreground truncate">
                {org.name}
              </h1>
              <span className="text-[13px] text-os-grey">
                {org.isIndividual ? "Individual partner" : "Partner organization"}
                {websiteHost && (
                  <>
                    {" · "}
                    <a
                      href={org.website!}
                      target="_blank"
                      rel="noreferrer"
                      className="transition-colors hover:text-foreground hover:underline"
                    >
                      {websiteHost}
                    </a>
                  </>
                )}
              </span>
            </div>
            {canEdit && tab !== "settings" && (
              <button type="button" onClick={() => setTab("settings")} className={os.actionBtn()}>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <OrgStatusPill status={status as PartnerRelationshipStatus} size="md" />
            <OrgTypePill type={org.type} size="md" />
            {org.tags.map((t) => (
              <DotPill key={t} size="md" className="font-normal text-os-grey">
                {t}
              </DotPill>
            ))}
          </div>
        </div>
      </header>

      <OsTabBar
        ariaLabel="Organization sections"
        tabs={ORG_TAB_VALUES.map((t) => ({ key: t, label: ORG_TAB_LABELS[t] }))}
        active={tab}
        onSelect={setTab}
      />

      {error && (
        <p className="rounded-os-item bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex min-h-[25vh] flex-col gap-6">
        {tab === "timeline" && (
          <PartnerActivityFeed
            activities={activities}
            nextCursor={activitiesNextCursor}
            scope={{ orgId: org.id }}
            actorNames={actorNames}
            canEdit={canEdit}
          />
        )}

        {tab === "contacts" && (
          <ContactsTab
            org={org}
            pendingInvites={pendingInvites}
            otherOrgs={otherOrgs}
            allContacts={allContacts}
            canEdit={canEdit}
          />
        )}

        {tab === "applications" && (
          <section className={os.sectionShell}>
            <h2 className={os.sectionTitle}>Applications</h2>
            <div className="rounded-os-card bg-os-card px-5">
              {org.applications.length === 0 ? (
                <p className="py-6 text-sm text-os-grey">No applications.</p>
              ) : (
                <ul>
                  {org.applications.map((a) => (
                    <li
                      key={a.id}
                      className="flex flex-wrap items-center gap-3 border-b border-os-container py-3 last:border-0"
                    >
                      <Link
                        to={`/core/partners/applications/${a.id}`}
                        className="min-w-0 flex-1 truncate text-sm font-medium text-foreground hover:underline"
                      >
                        {a.title}
                      </Link>
                      <PartnerStagePill stage={a.stage} />
                      {a.nextStep && <span className="text-xs text-os-grey">{a.nextStep}</span>}
                      <span className="whitespace-nowrap text-xs text-os-grey">
                        {relativeTime(a.lastActivityAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {tab === "projects" && <ProjectsTab org={org} linkableProjects={linkableProjects} canEdit={canEdit} />}

        {tab === "finance" && (
          <>
            <section className={os.sectionShell}>
              <h2 className={os.sectionTitle}>Deal terms</h2>
              <div className="rounded-os-card bg-os-card px-5">
                {org.applications.filter((a) => a.stage === "Accepted").length === 0 ? (
                  <p className="py-6 text-sm text-os-grey">No accepted applications yet.</p>
                ) : (
                  <ul>
                    {org.applications
                      .filter((a) => a.stage === "Accepted")
                      .map((a) => (
                        <li
                          key={a.id}
                          className="flex flex-wrap items-center gap-3 border-b border-os-container py-3 last:border-0"
                        >
                          <Link
                            to={`/core/partners/applications/${a.id}`}
                            className="min-w-0 flex-1 truncate text-sm font-medium text-foreground hover:underline"
                          >
                            {a.title}
                          </Link>
                          <span className="text-xs text-os-grey">
                            {a.fundingType
                              ? PROJECT_FUNDING_TYPE_LABELS[a.fundingType]
                              : "Funding type not set"}
                          </span>
                          <span className="text-xs text-os-grey">
                            {a.feeCents != null ? formatUsd(a.feeCents / 100) : "No fee set"}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            </section>

            <section className={os.sectionShell}>
              <h2 className={os.sectionTitle}>Chart strings</h2>
              <div className="rounded-os-card bg-os-card px-5">
                {chartStrings.length === 0 ? (
                  <p className="py-6 text-sm text-os-grey">No chart strings on file.</p>
                ) : (
                  <ul>
                    {chartStrings.map((cs) => (
                      <li
                        key={cs.id}
                        className="flex flex-wrap items-center gap-3 border-b border-os-container py-3 last:border-0"
                      >
                        <span className="font-mono text-sm text-foreground">{cs.raw}</span>
                        <span className="text-xs text-os-grey">{cs.termCode}</span>
                        <span className="text-xs text-os-grey">{cs.projectName}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <InvoicesPanel orgId={org.id} invoices={org.invoices} canEdit={canEdit} />
          </>
        )}

        {tab === "settings" && (
          <SettingsTab
            org={org}
            otherOrgs={otherOrgs}
            allContacts={allContacts}
            canEdit={canEdit}
            canDeleteOrg={canDeleteOrg}
          />
        )}
      </div>
    </div>
  );
}
