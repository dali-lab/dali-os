// Admin → Activities → editor (specs/activities.md §7.8). Edits an activity's
// window, audience (everyone / roles / group), and mechanic config, plus the
// status transitions (Draft ⇄ Published, Archive), Clone (for term reuse), and
// Delete (Draft/eventless only — archive otherwise). The mechanic's own config
// editor comes from the client registry.

import { useEffect, useState } from "react";
import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import type { Route } from "./+types/admin.activities.$id";
import { adminHandle } from "~/admin/adminNav";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { buttonClasses } from "~/components/ui/Button";
import { Toggle } from "~/components/ui/Toggle";
import { ROLE_TARGETS, type RoleTarget } from "~/lib/feature-flags";
import { activityKindLabel } from "~/lib/activities";
import { mechanicClient } from "~/activities/mechanics/registry";
import {
  cloneActivity,
  deleteActivity,
  setActivityStatus,
  updateActivity,
} from "~/lib/activities.server";

export const handle = adminHandle("activities");

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

  const [terms, groups, eventCount] = await Promise.all([
    prisma.term.findMany({ orderBy: { sortKey: "desc" }, select: { id: true, code: true } }),
    prisma.groupDefinition.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true },
    }),
    prisma.activityEvent.count({ where: { activityId: params.id } }),
  ]);

  return { activity, terms, groups, eventCount, viewerIsAdmin: false };
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
    return redirect(`/admin/activities/${clone.id}`);
  }

  if (intent === "delete") {
    const count = await prisma.activityEvent.count({ where: { activityId: id } });
    if (count > 0) {
      return Response.json(
        { error: "This activity has participation events — archive it instead of deleting." },
        { status: 400 },
      );
    }
    await deleteActivity(id);
    await logAuditEvent({ action: "activities.delete", userId: auth.user.sub, targetId: id, request });
    return redirect("/admin/activities");
  }

  if (intent === "publish" || intent === "unpublish" || intent === "archive") {
    const status = intent === "publish" ? "Published" : intent === "archive" ? "Archived" : "Draft";
    await setActivityStatus(id, status);
    await logAuditEvent({ action: "activities.status", userId: auth.user.sub, targetId: id, metadata: { status }, request });
    return redirect(`/admin/activities/${id}`);
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
      config,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Couldn't save." },
      { status: 400 },
    );
  }
  await logAuditEvent({ action: "activities.update", userId: auth.user.sub, targetId: id, request });
  return redirect(`/admin/activities/${id}`);
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminActivityEditor() {
  const { activity, terms, groups, eventCount } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { error?: string } | undefined;
  const error = actionData?.error ?? null;

  const mech = mechanicClient(activity.kind);

  const [name, setName] = useState(activity.name);
  const [termId, setTermId] = useState(activity.termId ?? "");
  const [everyone, setEveryone] = useState(activity.audienceEveryone);
  const [roles, setRoles] = useState<string[]>(activity.audienceRoles);
  const [groupId, setGroupId] = useState(activity.assignedGroupId ?? "");
  const [config, setConfig] = useState<unknown>(activity.config);
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

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link to="/admin/activities" className="text-sm text-muted-foreground hover:underline">
              Activities
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm font-medium text-foreground">{activity.name}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {activityKindLabel(activity.kind)} · {activity.status}
          </p>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Form method="post" className="flex flex-col gap-6">
        {/* Serialized complex fields */}
        <input type="hidden" name="audienceRoles" value={JSON.stringify(roles)} />
        <input type="hidden" name="config" value={JSON.stringify(config ?? {})} />
        <input type="hidden" name="startsAt" value={startsAt ? new Date(startsAt).toISOString() : ""} />
        <input type="hidden" name="endsAt" value={endsAt ? new Date(endsAt).toISOString() : ""} />

        <section className="grid gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">Name</span>
            <input
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">Term</span>
            <select
              name="termId"
              value={termId}
              onChange={(e) => setTermId(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">— None —</option>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code}
                </option>
              ))}
            </select>
          </label>
          <div />
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">Starts</span>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              suppressHydrationWarning
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">Ends</span>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              suppressHydrationWarning
              className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
        </section>

        {/* Audience */}
        <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">Audience</h2>
          <Toggle
            name="audienceEveryone"
            checked={everyone}
            onChange={(e) => setEveryone(e.target.checked)}
            label="Everyone in the lab"
            description="On for all members while the activity is live."
          />
          <div className={everyone ? "pointer-events-none opacity-40" : ""}>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Or target by role
            </p>
            <div className="flex flex-wrap gap-3">
              {ROLE_TARGETS.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={roles.includes(r)}
                    onChange={() => toggleRole(r)}
                  />
                  {ROLE_LABELS[r]}
                </label>
              ))}
            </div>
            <label className="mt-4 flex max-w-sm flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">And/or a group</span>
              <select
                name="assignedGroupId"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">— None —</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.type})
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {/* Mechanic config */}
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">
            {activityKindLabel(activity.kind)} settings
          </h2>
          {mech ? (
            <mech.AdminEditor value={config} onChange={setConfig} />
          ) : (
            <p className="text-sm text-muted-foreground">
              This activity type has no editor.
            </p>
          )}
        </section>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" name="intent" value="save" className={buttonClasses("primary", "md")}>
            Save changes
          </button>
          {activity.status !== "Published" ? (
            <button type="submit" name="intent" value="publish" className={buttonClasses("secondary", "md")}>
              Publish
            </button>
          ) : (
            <button type="submit" name="intent" value="unpublish" className={buttonClasses("secondary", "md")}>
              Unpublish
            </button>
          )}
          {activity.status !== "Archived" && (
            <button type="submit" name="intent" value="archive" className={buttonClasses("ghost", "md")}>
              Archive
            </button>
          )}
          <button type="submit" name="intent" value="clone" className={buttonClasses("ghost", "md")}>
            Clone
          </button>
          <span className="flex-1" />
          <button
            type="submit"
            name="intent"
            value="delete"
            disabled={!canDelete}
            title={canDelete ? undefined : "Archive instead — this activity has events or is published."}
            className={buttonClasses("destructive", "md")}
          >
            Delete
          </button>
        </div>
      </Form>
    </div>
  );
}
