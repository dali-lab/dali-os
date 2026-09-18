// Admin → Activities → editor: the Scoring & teams panel (specs/activities.md
// §4). Picks whether an activity scores per member or per team, and — for a team
// activity — builds the teams: auto-assign the audience into teams of N, or pair
// people up by hand with the member search.
//
// All of it is client state, serialized into the editor's one <Form> (the same
// shape audienceRoles and the mechanic config already use); the server
// reconciles it in saveActivityTeams. Nothing here writes on its own, so an
// abandoned edit is just a page the operator never saved.

import { useMemo } from "react";
import { Shuffle, Trash2, UserPlus, Users, X } from "lucide-react";
import { Select, Combobox } from "~/components/ui/floating";
import { buttonClasses } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import {
  autoAssignTeams,
  clampTeamSize,
  defaultTeamName,
  removeFromTeams,
  shuffled,
  MAX_TEAM_SIZE,
  MIN_TEAM_SIZE,
  type ActivityScoring,
  type ActivityTeamView,
  type RosterMember,
} from "~/lib/activities";

// Teams the editor invents locally carry a `new:` id so saveActivityTeams can
// tell them from rows that already exist (whose ids it must preserve).
const newTeamId = () => `new:${crypto.randomUUID()}`;

export function ActivityTeamsEditor({
  scoring,
  onScoringChange,
  teamSize,
  onTeamSizeChange,
  teams,
  onTeamsChange,
  roster,
  nameByUserId,
}: {
  scoring: ActivityScoring;
  onScoringChange: (v: ActivityScoring) => void;
  teamSize: number;
  onTeamSizeChange: (v: number) => void;
  teams: ActivityTeamView[];
  onTeamsChange: (v: ActivityTeamView[]) => void;
  /** The audience: who auto-assign draws from and the search offers. */
  roster: RosterMember[];
  /** Names for everyone the panel can render — the roster plus anyone already
   *  on a team who has since dropped out of the audience. */
  nameByUserId: Record<string, string>;
}) {
  const dialog = useDialog();

  const assigned = useMemo(
    () => new Set(teams.flatMap((t) => t.memberIds)),
    [teams],
  );
  const unassigned = roster.filter((m) => !assigned.has(m.id));

  // The search offers only people who are free — someone already paired up has
  // to be taken off their team first, which keeps "who is on two teams?" from
  // ever being a question.
  const addOptions = unassigned.map((m) => ({ value: m.id, label: m.name }));

  const addMember = (teamIndex: number, userId: string) => {
    const cleared = removeFromTeams(teams, userId);
    onTeamsChange(
      cleared.map((t, i) =>
        i === teamIndex ? { ...t, memberIds: [...t.memberIds, userId] } : t,
      ),
    );
  };

  const autoAssign = () => {
    // Shuffle so pairings aren't just the roster's alphabetical order.
    onTeamsChange(
      autoAssignTeams({
        roster: shuffled(roster.map((m) => m.id)),
        teams,
        teamSize,
        newTeamId,
      }),
    );
  };

  const clearTeams = async () => {
    const ok = await dialog.confirm({
      title: "Clear every team?",
      description:
        "All pairings are removed. Codes members already found are kept — they just stop counting toward a team until you pair people up again.",
      confirmLabel: "Clear teams",
      tone: "destructive",
    });
    if (ok) onTeamsChange([]);
  };

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Scoring</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Who competes: each member on their own, or teams sharing one score.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Competitors</span>
          <Select<ActivityScoring>
            value={scoring}
            onChange={onScoringChange}
            ariaLabel="Scoring"
            options={[
              {
                value: "Individual",
                label: "Individuals",
                description: "Everyone plays for themselves; the leaderboard ranks members.",
              },
              {
                value: "Team",
                label: "Teams",
                description: "Points are pooled per team; the leaderboard ranks teams.",
              },
            ]}
          />
        </label>
        {scoring === "Team" && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">People per team</span>
            <input
              type="number"
              min={MIN_TEAM_SIZE}
              max={MAX_TEAM_SIZE}
              value={teamSize}
              onChange={(e) => onTeamSizeChange(clampTeamSize(Number(e.target.value)))}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <span className="text-xs text-muted-foreground">
              Used when auto-assigning. {MIN_TEAM_SIZE} pairs people up.
            </span>
          </label>
        )}
      </div>

      {scoring === "Team" && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="mr-auto text-sm font-semibold text-foreground">
              Teams ({teams.length})
            </h3>
            <button
              type="button"
              onClick={autoAssign}
              disabled={unassigned.length === 0}
              title={
                unassigned.length === 0
                  ? "Everyone in the audience is already on a team."
                  : undefined
              }
              className={buttonClasses("secondary", "sm")}
            >
              <Shuffle className="h-3.5 w-3.5" /> Auto-assign ({unassigned.length})
            </button>
            <button
              type="button"
              onClick={() =>
                onTeamsChange([
                  ...teams,
                  { id: newTeamId(), name: defaultTeamName(teams.length), memberIds: [] },
                ])
              }
              className={buttonClasses("secondary", "sm")}
            >
              <UserPlus className="h-3.5 w-3.5" /> New team
            </button>
            {teams.length > 0 && (
              <button
                type="button"
                onClick={clearTeams}
                className={buttonClasses("ghost", "sm")}
              >
                Clear
              </button>
            )}
          </div>

          {roster.length === 0 && (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              No one is in this activity's audience yet. Set the audience above —
              a group, a role, or everyone — and the people in it show up here to
              pair up.
            </p>
          )}

          {teams.length === 0 ? (
            roster.length > 0 && (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                No teams yet. Auto-assign pairs up all {roster.length} of them, or
                add a team and pick people by hand.
              </p>
            )
          ) : (
            <div className="flex flex-col gap-2">
              {teams.map((team, i) => (
                <div
                  key={team.id}
                  className="flex flex-col gap-2 rounded-md border border-border bg-background p-3"
                >
                  <div className="flex items-center gap-2">
                    <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <input
                      value={team.name}
                      onChange={(e) =>
                        onTeamsChange(
                          teams.map((t, idx) =>
                            idx === i ? { ...t, name: e.target.value } : t,
                          ),
                        )
                      }
                      aria-label={`Team ${i + 1} name`}
                      className="min-w-0 flex-1 rounded border border-border bg-card px-2 py-1.5 text-sm font-medium"
                    />
                    <span
                      className={
                        team.memberIds.length > teamSize
                          ? "shrink-0 text-xs text-amber-600 dark:text-amber-500"
                          : "shrink-0 text-xs text-muted-foreground"
                      }
                    >
                      {team.memberIds.length}/{teamSize}
                    </span>
                    <button
                      type="button"
                      onClick={() => onTeamsChange(teams.filter((_, idx) => idx !== i))}
                      aria-label={`Remove ${team.name || `team ${i + 1}`}`}
                      className={buttonClasses("ghost", "sm")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {team.memberIds.map((id) => (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-card py-1 pl-2.5 pr-1 text-xs text-foreground"
                      >
                        {nameByUserId[id] ?? "Former member"}
                        <button
                          type="button"
                          onClick={() => onTeamsChange(removeFromTeams(teams, id))}
                          aria-label={`Remove ${nameByUserId[id] ?? "member"} from ${team.name}`}
                          className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    <Combobox
                      value=""
                      options={addOptions}
                      onChange={(userId) => addMember(i, userId)}
                      ariaLabel={`Add a member to ${team.name || `team ${i + 1}`}`}
                      placeholder="Search people…"
                      emptyLabel={
                        addOptions.length === 0 ? "Everyone is assigned" : "No matches"
                      }
                      className="rounded-full border border-dashed border-border px-3 py-1 text-xs"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {unassigned.length > 0 && teams.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                Not on a team ({unassigned.length}):
              </span>{" "}
              {unassigned.map((m) => m.name).join(", ")}. They can still enter
              codes — their finds start counting the moment they join a team.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
