import { useState, type ReactNode } from "react";
import { Form } from "react-router";
import { ChevronRight, ChevronDown, Info } from "lucide-react";
import { useOsChrome } from "~/components/os-chrome";
import { ChartStringPanel } from "~/projects/components/ChartStringPanel";
import { cn } from "~/lib/cn";
import { EditableSection } from "~/components/EditableSection";
import { ProjectInfraSection } from "~/projects/components/ProjectInfraSection";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { PartnersSection } from "~/projects/components/detail/PartnersSection";
import { DescriptionSegment, DetailsSegment } from "~/projects/components/detail/DetailsSegments";
import { type LoaderData } from "~/projects/components/detail/types";
import { ACTIVITY_LABELS, relativeTime } from "~/projects/components/detail/constants";
import { PrincipalInvestigatorsSection, TeamSection } from "~/projects/components/detail/TeamSection";
import { MeetingsSection } from "~/projects/components/detail/MeetingsSection";

function ChallengeDomain({
  domainName,
  scope,
}: {
  domainName: string;
  scope: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-left text-[15px] font-semibold text-foreground transition-colors hover:text-os-accent"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        )}
        {domainName}
      </button>
      {open && (
        <p className="mt-1 whitespace-pre-wrap pl-[22px] text-sm text-foreground">
          {scope}
        </p>
      )}
    </div>
  );
}
export function OverviewTab({
  planning,
  project,
  teams,
  upcomingMeetings,
  showMeetings = true,
  recentActivity,
  canEdit,
  canEditFinance,
  canEditAssignmentLevel,
  canManagePartners,
  hasActivePartner,
  linkablePartnerOrgs,
  domainScopeGrid,
  plannedTerms,
  pisByTerm,
  coreMembers,
  currentTerm,
  chartStrings,
  allTermOptions,
  infra,
}: {
  // The epics & sprints timeline, rendered at the top of the body. Passed in
  // as an element so Overview doesn't have to re-declare all of Planning's
  // props just to forward them.
  planning: ReactNode;
  project: LoaderData["project"];
  teams: LoaderData["teams"];
  upcomingMeetings: LoaderData["upcomingMeetings"];
  // False under the os tab set, where meetings ride the Progress timeline.
  showMeetings?: boolean;
  recentActivity: LoaderData["recentActivity"];
  canEdit: boolean;
  canEditFinance: boolean;
  canEditAssignmentLevel: boolean;
  canManagePartners: boolean;
  hasActivePartner: boolean;
  linkablePartnerOrgs: LoaderData["linkablePartnerOrgs"];
  domainScopeGrid: LoaderData["domainScopeGrid"];
  plannedTerms: LoaderData["plannedTerms"];
  pisByTerm: LoaderData["pisByTerm"];
  coreMembers: LoaderData["coreMembers"];
  currentTerm: LoaderData["currentTerm"];
  chartStrings: LoaderData["chartStrings"];
  allTermOptions: LoaderData["allTermOptions"];
  infra: LoaderData["infra"];
}) {
  const [showFutureChallenges, setShowFutureChallenges] = useState(false);
  const tz = useUserTimeZone();
  // Under dali.os a section is a title over its content, not a box around it —
  // so the cards these sections hold stop showing a second border inside a first.
  const { sectionShell, sectionTitle } = useOsChrome();

  // The current term's per-domain challenge, read-only on Overview. Edited in
  // the Scope settings popup. Only non-empty cells for the current term show.
  const currentChallenges = currentTerm
    ? domainScopeGrid.filter(
        (c) => c.termId === currentTerm.id && c.scope.trim() !== "",
      )
    : [];

  // Future planned terms with non-empty challenge text, soonest first —
  // collapsed under the current term so members can see where the project is
  // headed without the Core-only settings gear. Read-only, like the above.
  const futureChallengeGroups = currentTerm
    ? plannedTerms
        .filter((t) => t.sortKey > currentTerm.sortKey)
        .sort((a, b) => a.sortKey - b.sortKey)
        .map((t) => ({
          termId: t.id,
          termCode: t.code,
          cells: domainScopeGrid.filter(
            (c) => c.termId === t.id && c.scope.trim() !== "",
          ),
        }))
        .filter((g) => g.cells.length > 0)
    : [];

  return (
    <div className="flex flex-col gap-4">
      {/* Epics & sprints timeline, on top — the planning view is the first
          thing the project page shows. */}
      {planning}

      {/* Description — separate from Project details */}
      <DescriptionSegment description={project.description} canEdit={canEdit} />

      {/* Challenge for the current term, per declared domain (read-only). */}
      {currentTerm &&
        (currentChallenges.length > 0 || futureChallengeGroups.length > 0) && (
          <section className={sectionShell}>
            <div className="flex items-center justify-between">
              <h3 className={sectionTitle}>
                Challenge{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  · {currentTerm.code}
                </span>
              </h3>
              {futureChallengeGroups.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowFutureChallenges((v) => !v)}
                  className="text-xs font-medium text-os-accent hover:underline"
                >
                  {showFutureChallenges
                    ? "Hide upcoming terms"
                    : `Upcoming terms (${futureChallengeGroups.length})`}
                </button>
              )}
            </div>
            {/* The body takes the surface under os; the section around it is
                only a title, so this is the one card here. */}
            <div className="rounded-os-card bg-os-container/40 p-4">
              {currentChallenges.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {currentChallenges.map((c) => (
                    <ChallengeDomain
                      key={c.domainId}
                      domainName={c.domainName}
                      scope={c.scope}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  No challenge for {currentTerm.code} yet.
                </p>
              )}
              {showFutureChallenges &&
                futureChallengeGroups.map((g) => (
                  <div key={g.termId} className="mt-4 pt-3 border-t border-border">
                    <div className="text-xs font-semibold text-muted-foreground mb-2">
                      {g.termCode}
                    </div>
                    <div className="flex flex-col gap-2">
                      {g.cells.map((c) => (
                        <ChallengeDomain
                          key={c.domainId}
                          domainName={c.domainName}
                          scope={c.scope}
                        />
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </section>
        )}

      {/* Partner organizations funding this project. Core manages links. */}
      <PartnersSection
        partners={project.partners}
        linkablePartnerOrgs={linkablePartnerOrgs}
        canManage={canManagePartners}
      />

      {/* Project details. Editable as one section; commits via intent=details
          which expects the full field set. Section-level Save submits and
          closes; Cancel reverts (the wrapper remounts the body which resets
          defaultValue inputs). */}
      <DetailsSegment
        project={project}
        canEdit={canEdit}
        canEditFinance={canEditFinance}
      />

      {/* Payroll chart strings. Core-only, and its own section rather than a
          row inside Project details: that section commits as one
          full-replacement form, while each chart string is an append that
          supersedes its predecessor. It also carries its own fetcher.Form,
          which cannot nest inside the details Form. */}
      {canEditFinance && (
        <EditableSection
          title="Payroll chart strings"
          icon={<Info className="w-4 h-4" />}
          canEdit={false}
        >
          {() => (
            <ChartStringPanel
              chartStrings={chartStrings}
              termOptions={allTermOptions}
              currentTermId={currentTerm?.id ?? null}
            />
          )}
        </EditableSection>
      )}

      {/* Cloud infrastructure (Fly + Neon): read-only inventory/usage for any
          member; config + change-requests for staffed (core||isProjectMember).
          Wears the shared EditableSection primitive (own section shell). */}
      <ProjectInfraSection
        projectId={project.id}
        canEdit={canEdit}
        config={infra.config}
        view={infra.view}
        requests={infra.requests}
        knownOrgs={infra.knownOrgs}
        setupErrors={infra.setupErrors}
      />

      {/* Principal Investigators — the Core member in charge of this project
          per term. Core (canEditFinance, mirroring the renewals surface) can
          reassign; everyone else sees a read-only roster. */}
      <section className={sectionShell}>
        <PrincipalInvestigatorsSection
          plannedTerms={plannedTerms}
          pisByTerm={pisByTerm}
          coreMembers={coreMembers}
          canEdit={canEditFinance}
          currentTermId={currentTerm?.id ?? null}
        />
      </section>

      {/* Team — read-only summary, separate from the editable details. */}
      <section className={sectionShell}>
        <TeamSection
          teams={teams}
          canEdit={canEditAssignmentLevel}
          currentTermCode={currentTerm?.code ?? null}
        />
      </section>

      {/* Next scheduled meetings for this project. Under the os tabs this is a
          tab of its own, so Overview stops rendering it here. */}
      {showMeetings && <MeetingsSection meetings={upcomingMeetings} />}

      {/* Recent project-scoped audit activity — editors only (the loader
          returns an empty list otherwise). Read-only. */}
      {canEdit && recentActivity.length > 0 && (
        <section className={sectionShell}>
          <h2 className={sectionTitle}>
            Recent activity
          </h2>
          <ul className={cn("flex flex-col gap-2", "rounded-os-card bg-os-container/40 p-4")}>
            {recentActivity.map((a) => (
              <li key={a.id} className="text-xs text-muted-foreground">
                <span className="text-foreground font-medium">{a.actorName}</span>{" "}
                {ACTIVITY_LABELS[a.action] ?? a.action}
                <span className="text-muted-foreground/70">
                  {" "}
                  · {relativeTime(a.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
