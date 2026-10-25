// Admin → Onboarding → <activity> (specs/activities.md §7.8). The mechanic's
// own config editor comes from the client registry; the teams panel is
// ActivityTeamsEditor.

import { useEffect, useState } from "react";
import { Form, redirect, useActionData, useLoaderData } from "react-router";
import { Archive, Copy, Trash2 } from "lucide-react";
import type { Route } from "./+types/admin.activities.$id";
import { AdminSectionHeader, adminTrail } from "~/admin/adminNav";
import { Pill, type Tone } from "~/admin/components/console-ui";
import { useOsChrome } from "~/components/os-chrome";
import { Checkbox } from "~/components/ui/Checkbox";
import { DateField } from "~/components/ui/DateField";
import { Select, Tooltip } from "~/components/ui/floating";
import { cn } from "~/lib/cn";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isAdmin, isCore } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { listAllGroups } from "~/lib/groups";
import { orderGroupsForPicker } from "~/lib/group-kind";
import { logAuditEvent } from "~/lib/audit";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { Toggle } from "~/components/ui/Toggle";
import { ROLE_TARGETS, type RoleTarget } from "~/lib/feature-flags";
import {
  activityKindLabel,
  clampTeamSize,
  type ActivityScoring,
  type ActivityTeamView,
} from "~/lib/activities";
import { mechanicClient } from "~/activities/mechanics/registry";
import { ActivityTeamsEditor } from "~/admin/components/ActivityTeamsEditor";
import {
  cloneActivity,
  deleteActivity,
  listActivityTeams,
  resolveActivityRoster,
  saveActivityTeams,
  setActivityStatus,
  updateActivity,
} from "~/lib/activities.server";
import { fullName } from "~/lib/display";

export const handle = {
  roomyBreadcrumb: true,
  breadcrumbTrail: (data: unknown) => {
    const d = data as
      | { activity?: { name: string }; viewerIsAdmin?: boolean; isAdmin?: boolean }
      | undefined;
    const base = adminTrail("onboarding", !!d?.isAdmin || !!d?.viewerIsAdmin);
    return d?.activity?.name ? [...base, { label: d.activity.name }] : base;
  },
};

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.activity?.name ?? "Activity"} · Admin · DALI OS` },
];

const ROLE_LABELS: Record<RoleTarget, string> = {
  isCore: "Core",
  isAdmin: "Admin",
  isDomainLead: "Domain Lead",
  isInstructor: "Instructor",
  isInterviewer: "Interviewer",
  isStaff: "Staff",
  isAlumni: "Alumni",
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const activity = await prisma.activity.findUnique({ where: { id: params.id } });
  if (!activity) throw new Response("Not found", { status: 404 });

  const [terms, allGroups, eventCount, roster, teams, viewerIsAdmin] = await Promise.all([
    prisma.term.findMany({ orderBy: { sortKey: "desc" }, select: { id: true, code: true } }),
    listAllGroups(),
    prisma.activityEvent.count({ where: { activityId: params.id } }),
    resolveActivityRoster(activity),
    listActivityTeams(params.id),
    isAdmin(auth.user.sub),
  ]);
  const groups = allGroups
    .filter((g) => !g.archived)
    .map((g) => ({
      id: g.id,
      name: g.name,
      type: g.type,
      systemKey: g.systemKey,
      memberCount: g.memberIds.length,
    }));

  // Everyone the teams panel has to name: the audience, plus anyone already on
  // a team who has since fallen out of it (a group edited mid-activity), who
  // would otherwise render as a blank chip.
  const nameByUserId: Record<string, string> = Object.fromEntries(
    roster.map((m) => [m.id, m.name]),
  );
  const orphans = [...new Set(teams.flatMap((t) => t.memberIds))].filter(
    (id) => !(id in nameByUserId),
  );
  if (orphans.length > 0) {
    const rows = await prisma.user.findMany({
      where: { id: { in: orphans } },
      select: { id: true, firstName: true, lastName: true },
    });
    for (const u of rows) nameByUserId[u.id] = fullName(u);
  }

  return { activity, terms, groups, eventCount, roster, teams, nameByUserId, viewerIsAdmin };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) return redirect("/");
  const id = params.id;

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "clone") {
    const clone = await cloneActivity(id, auth.user.sub);
    await logAuditEvent({ action: "activities.clone", userId: auth.user.sub, targetId: clone.id, metadata: { from: id }, request });
    return redirect(`/admin/onboarding/${clone.id}`);
  }

  if (intent === "delete") {
    const count = await prisma.activityEvent.count({ where: { activityId: id } });
    if (count > 0) {
      return Response.json(
        { error: "This activity has participation events. Archive it instead of deleting." },
        { status: 400 },
      );
    }
    await deleteActivity(id);
    await logAuditEvent({ action: "activities.delete", userId: auth.user.sub, targetId: id, request });
    return redirect("/admin/onboarding");
  }

  if (intent === "publish" || intent === "unpublish" || intent === "archive") {
    const status = intent === "publish" ? "Published" : intent === "archive" ? "Archived" : "Draft";
    await setActivityStatus(id, status);
    await logAuditEvent({ action: "activities.status", userId: auth.user.sub, targetId: id, metadata: { status }, request });
    return redirect(`/admin/onboarding/${id}`);
  }

  // save
  const name = String(form.get("name") ?? "").trim();
  const termId = String(form.get("termId") ?? "") || null;
  const audienceEveryone = form.get("audienceEveryone") === "on";
  const assignedGroupId = String(form.get("assignedGroupId") ?? "") || null;

  let audienceRoles: string[] = [];
  try {
    const parsed = JSON.parse(String(form.get("audienceRoles") ?? "[]"));
    if (Array.isArray(parsed)) audienceRoles = parsed.map(String);
  } catch {
    /* keep empty */
  }

  let config: unknown = {};
  try {
    config = JSON.parse(String(form.get("config") ?? "{}"));
  } catch {
    return Response.json({ error: "Invalid config." }, { status: 400 });
  }

  const scoring: ActivityScoring = form.get("scoring") === "Team" ? "Team" : "Individual";
  const teamSize = clampTeamSize(Number(form.get("teamSize") ?? 2));

  // Teams arrive as the editor's client state. Shapes that don't parse are a
  // bug, not operator input, so fail loudly rather than silently wiping teams.
  let teams: ActivityTeamView[] = [];
  try {
    const parsed = JSON.parse(String(form.get("teams") ?? "[]"));
    if (!Array.isArray(parsed)) throw new Error("not a list");
    teams = parsed.map((t: ActivityTeamView) => ({
      id: String(t.id),
      name: String(t.name ?? ""),
      memberIds: Array.isArray(t.memberIds) ? t.memberIds.map(String) : [],
    }));
  } catch {
    return Response.json({ error: "Invalid teams." }, { status: 400 });
  }

  const startsAtRaw = String(form.get("startsAt") ?? "");
  const endsAtRaw = String(form.get("endsAt") ?? "");
  const startsAt = startsAtRaw ? new Date(startsAtRaw) : undefined;
  const endsAt = endsAtRaw ? new Date(endsAtRaw) : undefined;

  if (!name) return Response.json({ error: "Name is required." }, { status: 400 });
  if (startsAt && endsAt && startsAt.getTime() >= endsAt.getTime()) {
    return Response.json({ error: "End must be after start." }, { status: 400 });
  }

  try {
    await updateActivity(id, {
      name,
      termId,
      startsAt,
      endsAt,
      audienceEveryone,
      audienceRoles,
      assignedGroupId,
      scoring,
      teamSize,
      config,
    });
    // Individual scoring keeps its teams on the row rather than deleting them,
    // so an operator who flips to Individual and back doesn't lose the pairings
    // they built. Nothing reads them while scoring is Individual.
    if (scoring === "Team") await saveActivityTeams(id, teams);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Couldn't save." },
      { status: 400 },
    );
  }
  await logAuditEvent({ action: "activities.update", userId: auth.user.sub, targetId: id, request });
  return redirect(`/admin/onboarding/${id}`);
}

const STATUS_TONE: Record<string, Tone> = {
  Draft: "warn",
  Published: "ok",
  Archived: "idle",
};

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const FORM_ID = "activity-form";

export default function AdminActivityEditor() {
  const { activity, terms, groups, eventCount, roster, teams: savedTeams, nameByUserId } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { error?: string } | undefined;
  const error = actionData?.error ?? null;
  const {
    panel,
    sectionShell,
    sectionTitle,
    bodyText,
    formClass,
    formTrigger,
    fieldLabel,
    actionBtn,
    actionBtnPrimary,
    iconBtn,
  } = useOsChrome();

  const mech = mechanicClient(activity.kind);
  const confirmSubmit = useConfirmSubmit();

  const [name, setName] = useState(activity.name);
  const [termId, setTermId] = useState(activity.termId ?? "");
  const [everyone, setEveryone] = useState(activity.audienceEveryone);
  const [roles, setRoles] = useState<string[]>(activity.audienceRoles);
  const [groupId, setGroupId] = useState(activity.assignedGroupId ?? "");
  const [config, setConfig] = useState<unknown>(activity.config);
  const [scoring, setScoring] = useState<ActivityScoring>(activity.scoring);
  const [teamSize, setTeamSize] = useState(activity.teamSize);
  const [teams, setTeams] = useState<ActivityTeamView[]>(savedTeams);
  // datetime-local values are filled after mount to keep SSR/client markup in
  // sync (the local formatting differs from the server's UTC).
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  useEffect(() => {
    setStartsAt(toLocalInputValue(activity.startsAt as unknown as string));
    setEndsAt(toLocalInputValue(activity.endsAt as unknown as string));
  }, [activity.startsAt, activity.endsAt]);

  const toggleRole = (r: string) =>
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  const canDelete = activity.status === "Draft" && eventCount === 0;
  const kindLabel = activityKindLabel(activity.kind);

  const saveButton = (
    <button type="submit" form={FORM_ID} name="intent" value="save" className={actionBtnPrimary}>
      Save changes
    </button>
  );

  return (
    <div className="flex flex-col gap-8">
      <AdminSectionHeader
        section="onboarding"
        title={activity.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {kindLabel}
            <Pill tone={STATUS_TONE[activity.status] ?? "idle"}>{activity.status}</Pill>
          </span>
        }
        actions={
          <>
            <Tooltip content="Clone">
              <button type="submit" form={FORM_ID} name="intent" value="clone" aria-label="Clone" className={iconBtn}>
                <Copy className="h-4 w-4" />
              </button>
            </Tooltip>
            {activity.status !== "Archived" && (
              <Tooltip content="Archive">
                <button type="submit" form={FORM_ID} name="intent" value="archive" aria-label="Archive" className={iconBtn}>
                  <Archive className="h-4 w-4" />
                </button>
              </Tooltip>
            )}
            <Tooltip
              content={canDelete ? "Delete" : "Only a draft with no events can be deleted. Archive it instead."}
            >
              <span tabIndex={canDelete ? -1 : 0} className="inline-flex">
                <button
                  type="submit"
                  form={FORM_ID}
                  name="intent"
                  value="delete"
                  disabled={!canDelete}
                  aria-label="Delete"
                  className={cn(iconBtn, "hover:text-destructive disabled:pointer-events-none disabled:opacity-40")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </span>
            </Tooltip>
            {activity.status !== "Published" ? (
              <button type="submit" form={FORM_ID} name="intent" value="publish" className={actionBtn()}>
                Publish
              </button>
            ) : (
              <button type="submit" form={FORM_ID} name="intent" value="unpublish" className={actionBtn()}>
                Unpublish
              </button>
            )}
            {saveButton}
          </>
        }
      />

      {error && (
        <p className="rounded-os-item bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>
      )}

      {/* Save / Publish / Clone submit straight through; the three that take an
          activity away from its participants confirm first. */}
      <Form
        id={FORM_ID}
        method="post"
        className={cn("grid gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start")}
        onSubmit={confirmSubmit((submitter) => {
          switch (submitter?.value) {
            case "unpublish":
              return {
                title: `Unpublish ${activity.name}?`,
                description:
                  "It returns to Draft and disappears for participants. Any scores already recorded are kept.",
                confirmLabel: "Unpublish",
                tone: "destructive",
              };
            case "archive":
              return {
                title: `Archive ${activity.name}?`,
                description:
                  "It closes for participants and moves out of the active list. Scores and teams are kept, and you can clone it for a future term.",
                confirmLabel: "Archive",
                tone: "destructive",
              };
            case "delete":
              return {
                title: `Delete ${activity.name}?`,
                description:
                  "This removes the activity and its teams for good. Archive instead if you might want its history.",
                confirmLabel: "Delete",
                tone: "destructive",
              };
            default:
              return null;
          }
        })}
      >
        <input type="hidden" name="audienceRoles" value={JSON.stringify(roles)} />
        <input type="hidden" name="config" value={JSON.stringify(config ?? {})} />
        <input type="hidden" name="scoring" value={scoring} />
        <input type="hidden" name="teamSize" value={teamSize} />
        <input type="hidden" name="teams" value={JSON.stringify(teams)} />
        <input type="hidden" name="termId" value={termId} />
        <input type="hidden" name="assignedGroupId" value={groupId} />
        <input type="hidden" name="startsAt" value={startsAt ? new Date(startsAt).toISOString() : ""} />
        <input type="hidden" name="endsAt" value={endsAt ? new Date(endsAt).toISOString() : ""} />

        <div className="flex flex-col gap-8">
          <section className={sectionShell} aria-labelledby="details-title">
            <h2 id="details-title" className={sectionTitle}>
              Details
            </h2>
            <div className={cn(panel, formClass, "grid gap-4 p-6 sm:grid-cols-2")}>
              <label className={cn(fieldLabel, "sm:col-span-2")}>
                Name
                <input type="text" name="name" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className={fieldLabel}>
                Term
                <Select
                  value={termId}
                  onChange={setTermId}
                  ariaLabel="Term"
                  options={[{ value: "", label: "None" }, ...terms.map((t) => ({ value: t.id, label: t.code }))]}
                  buttonClassName={formTrigger}
                />
              </label>
              <div className="hidden sm:block" />
              <div className={fieldLabel}>
                Starts
                <DateField
                  mode="datetime-local"
                  value={startsAt}
                  onChange={setStartsAt}
                  ariaLabel="Starts"
                  buttonClassName={formTrigger}
                />
              </div>
              <div className={fieldLabel}>
                Ends
                <DateField
                  mode="datetime-local"
                  value={endsAt}
                  onChange={setEndsAt}
                  ariaLabel="Ends"
                  buttonClassName={formTrigger}
                />
              </div>
            </div>
          </section>

          <section className={sectionShell} aria-labelledby="settings-title">
            <h2 id="settings-title" className={sectionTitle}>
              {kindLabel} settings
            </h2>
            <div className={cn(panel, "p-6")}>
              {mech ? (
                <mech.AdminEditor value={config} onChange={setConfig} />
              ) : (
                <p className={bodyText}>This activity type has no editor.</p>
              )}
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-8">
          <section className={sectionShell} aria-labelledby="audience-title">
            <h2 id="audience-title" className={sectionTitle}>
              Audience
            </h2>
            <div className={cn(panel, formClass, "flex flex-col gap-5 p-6")}>
              <Toggle
                tone="os"
                name="audienceEveryone"
                checked={everyone}
                onChange={(e) => setEveryone(e.target.checked)}
                label="Everyone in the lab"
                description="On for all members while the activity is live."
              />
              <div className={cn("flex flex-col gap-5", everyone && "pointer-events-none opacity-40")}>
                <div className="flex flex-col gap-2.5">
                  <p className="text-xs font-semibold text-os-muted">Or target by role</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    {ROLE_TARGETS.map((r) => (
                      <Checkbox
                        key={r}
                        tone="os"
                        checked={roles.includes(r)}
                        onChange={() => toggleRole(r)}
                        label={ROLE_LABELS[r]}
                      />
                    ))}
                  </div>
                </div>
                <label className={fieldLabel}>
                  And/or a group
                  <Select
                    value={groupId}
                    onChange={setGroupId}
                    ariaLabel="Group"
                    options={[
                      { value: "", label: "None" },
                      ...orderGroupsForPicker(groups, groupId ? [groupId] : []).map((g) => ({
                        value: g.id,
                        label: `${g.name} (${g.type})`,
                      })),
                    ]}
                    buttonClassName={formTrigger}
                  />
                </label>
              </div>
            </div>
          </section>

          <ActivityTeamsEditor
            scoring={scoring}
            onScoringChange={setScoring}
            teamSize={teamSize}
            onTeamSizeChange={setTeamSize}
            teams={teams}
            onTeamsChange={setTeams}
            roster={roster}
            nameByUserId={nameByUserId}
          />
        </div>
      </Form>

      <div className="flex justify-end">{saveButton}</div>
    </div>
  );
}
