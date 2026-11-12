import { useState } from "react";
import { Link, useSubmit } from "react-router";
import { Select } from "~/components/ui/floating";
import { Folder, ChevronRight, ChevronDown } from "lucide-react";
import { useOsChrome } from "~/components/os-chrome";
import { Avatar } from "~/components/ui/Avatar";
import { Pill } from "~/components/ui/Pill";
import { type LoaderData } from "~/projects/components/detail/types";

/* One term's roster. Split out of TeamSection because the current term renders
   at the top level and the older ones render inside the "Previous teams"
   folder — same markup, two places. */
function TeamTermGroup({
  team,
  canEdit,
  currentTermCode,
}: {
  team: LoaderData["teams"][number];
  canEdit: boolean;
  currentTermCode: string | null;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground mb-1.5">
        {team.code}
        {/* "Current" only when this group's term IS the current term —
            the newest group may be a past term on a wrapped project. */}
        {currentTermCode !== null && team.code === currentTermCode && (
          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded border border-accent-teal/40 bg-accent-teal/15 text-accent-teal">
            Current
          </span>
        )}
      </div>
      {/* The design's member cards: avatar, name, and the role as plain text.
          The level itself is not shown — P1/P2/P3 is an internal ladder, and
          the only part of it this page needs to say is who mentors each
          domain, which is the domain's P3. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {team.members.map((m) => (
          <div
            key={m.assignmentId}
            className="flex items-center gap-3 rounded-os-item bg-os-container/40 p-3"
          >
            <Avatar photoUrl={m.photoUrl} name={m.name} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground">
                {m.name}
              </div>
              <div className="truncate text-[12px] text-os-muted">
                {m.domain}
              </div>
            </div>
            {m.level === "P3" &&
              (canEdit ? (
                <Link
                  to={`/members/${m.userId}#project-assignments`}
                  title={`Change ${m.name}'s level on their profile`}
                  className="flex-shrink-0"
                >
                  <Pill tone="accent" size="sm" className="transition-colors hover:bg-os-accent/25">
                    Mentor
                  </Pill>
                </Link>
              ) : (
                <Pill tone="accent" size="sm" className="flex-shrink-0">
                  Mentor
                </Pill>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
export function PrincipalInvestigatorsSection({
  plannedTerms,
  pisByTerm,
  coreMembers,
  canEdit,
  currentTermId,
}: {
  plannedTerms: LoaderData["plannedTerms"];
  pisByTerm: LoaderData["pisByTerm"];
  coreMembers: LoaderData["coreMembers"];
  canEdit: boolean;
  currentTermId: string | null;
}) {
  const submit = useSubmit();
  const { sectionTitle } = useOsChrome();
  if (plannedTerms.length === 0) return null;
  const upcoming = currentTermId
    ? plannedTerms.filter((t) => {
        const current = plannedTerms.find((p) => p.id === currentTermId);
        return !current || t.sortKey >= current.sortKey;
      })
    : plannedTerms;
  const rows = upcoming.length > 0 ? upcoming : plannedTerms.slice(0, 1);
  return (
    <div className="flex flex-col gap-2">
      <h2 className={sectionTitle}>
        Principal Investigators
      </h2>
      <div className="flex flex-col gap-2 rounded-os-card bg-os-container/40 p-3">
        {rows.map((t) => {
          const pi = pisByTerm[t.id] ?? null;
          const isCurrent = currentTermId !== null && t.id === currentTermId;
          const options = [
            { value: "", label: "No PI" },
            ...(pi && !coreMembers.some((m) => m.userId === pi.userId)
              ? [{ value: pi.userId, label: pi.name }]
              : []),
            ...coreMembers.map((m) => ({ value: m.userId, label: m.name })),
          ];
          return (
            <div
              key={t.id}
              className="grid grid-cols-[minmax(80px,120px)_minmax(0,1fr)] items-center gap-3"
            >
              <div className="text-xs font-medium text-muted-foreground">
                {t.code}
                {isCurrent && (
                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded border border-accent-teal/40 bg-accent-teal/15 text-accent-teal">
                    Current
                  </span>
                )}
              </div>
              {canEdit ? (
                <Select
                  ariaLabel={`PI for ${t.code}`}
                  value={pi?.userId ?? ""}
                  onChange={(v) => {
                    const form = new FormData();
                    form.set("intent", "pi");
                    form.set("termId", t.id);
                    form.set("piUserId", v);
                    submit(form, { method: "post" });
                  }}
                  options={options}
                />
              ) : (
                <div className="text-sm text-foreground">
                  {pi?.name ?? <span className="italic text-muted-foreground">No PI</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
export function TeamSection({
  teams,
  canEdit,
  currentTermCode,
}: {
  teams: LoaderData["teams"];
  canEdit: boolean;
  currentTermCode: string | null;
}) {
  const [showPrevious, setShowPrevious] = useState(false);
  const { sectionTitle } = useOsChrome();
  // teams is pre-sorted newest term first by the loader, so the head is the
  // roster the page is about and the tail is history.
  const [currentTeam, ...previousTeams] = teams;

  return (
    <div className="flex flex-col gap-2">
      <h2 className={sectionTitle}>
        Team
      </h2>
      {teams.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No team assignments yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <TeamTermGroup
            team={currentTeam}
            canEdit={canEdit}
            currentTermCode={currentTermCode}
          />

          {/* Past terms live in a folder rather than in the roster: a project
              that has run for eight terms otherwise buries this term's team
              under seven that have moved on. */}
          {previousTeams.length > 0 && (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setShowPrevious((v) => !v)}
                aria-expanded={showPrevious}
                className="flex w-full items-center gap-2 rounded-os-item bg-os-container/40 px-3 py-2.5 text-left text-sm font-semibold text-os-grey transition-colors hover:text-foreground"
              >
                {showPrevious ? (
                  <ChevronDown className="h-4 w-4 flex-shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 flex-shrink-0" />
                )}
                <Folder className="h-4 w-4 flex-shrink-0" />
                Previous teams
                <span className="ml-auto text-xs font-semibold text-os-muted">
                  {previousTeams.length}
                </span>
              </button>
              {showPrevious &&
                previousTeams.map((team) => (
                  <TeamTermGroup
                    key={team.code}
                    team={team}
                    canEdit={canEdit}
                    currentTermCode={currentTermCode}
                  />
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* The project's upcoming meetings. A card inside Overview classically; the
   whole body of the Meetings tab under the os tab set, where it carries an
   empty state because a tab you can click and get nothing from reads as
   broken in a way a hidden card never did. */
