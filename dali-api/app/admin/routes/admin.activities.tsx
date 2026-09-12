// Admin → System & Insights → Activities (specs/activities.md §7.8). Lists all
// activities and creates a new one (name + mechanic + term; the window defaults
// and is refined on the detail page). Distinct from "Activity" (the audit log).
// Core-visible, same tier as Feature Flags.

import { Form, Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/admin.activities";
import { adminHandle } from "~/admin/adminNav";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { buttonClasses } from "~/components/ui/Button";
import {
  ACTIVITY_KINDS,
  activityKindLabel,
  isActivityKind,
} from "~/lib/activities";
import {
  cloneActivity,
  createActivity,
  listActivitiesForAdmin,
} from "~/lib/activities.server";

export const handle = adminHandle("activities");

export const meta: Route.MetaFunction = () => [
  { title: "Activities · Admin · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const [activities, terms] = await Promise.all([
    listActivitiesForAdmin(),
    prisma.term.findMany({ orderBy: { sortKey: "desc" }, select: { id: true, code: true } }),
  ]);
  return { activities, terms, viewerIsAdmin: false };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "clone") {
    const id = String(form.get("id") ?? "");
    const clone = await cloneActivity(id, auth.user.sub);
    await logAuditEvent({
      action: "activities.clone",
      userId: auth.user.sub,
      targetId: clone.id,
      metadata: { from: id },
      request,
    });
    return redirect(`/admin/activities/${clone.id}`);
  }

  // create
  const name = String(form.get("name") ?? "").trim();
  const kind = String(form.get("kind") ?? "");
  const termId = String(form.get("termId") ?? "") || null;
  if (!name) return Response.json({ error: "Name is required." }, { status: 400 });
  if (!isActivityKind(kind)) return Response.json({ error: "Pick a type." }, { status: 400 });

  const now = new Date();
  const created = await createActivity(
    {
      kind,
      name,
      termId,
      startsAt: now,
      endsAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    },
    auth.user.sub,
  );
  await logAuditEvent({
    action: "activities.create",
    userId: auth.user.sub,
    targetId: created.id,
    metadata: { kind, name },
    request,
  });
  return redirect(`/admin/activities/${created.id}`);
}

const STATUS_BADGE: Record<string, string> = {
  Draft: "bg-muted text-muted-foreground",
  Published: "bg-accent-coral/10 text-accent-coral",
  Archived: "bg-muted text-muted-foreground line-through",
};

export default function AdminActivities() {
  const { activities, terms } = useLoaderData<typeof loader>();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Activities</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Time-boxed onboarding activities and site modes (e.g. the onboarding
          scavenger hunt). Gate the whole feature with the <code>activities</code>{" "}
          flag, then publish an activity to run it.
        </p>
      </div>

      {/* Create */}
      <Form
        method="post"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4"
      >
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Name</span>
          <input
            name="name"
            required
            placeholder="Fall onboarding hunt"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Type</span>
          <select name="kind" className="rounded-md border border-border bg-background px-3 py-2 text-sm">
            {ACTIVITY_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Term</span>
          <select name="termId" className="rounded-md border border-border bg-background px-3 py-2 text-sm">
            <option value="">— None —</option>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.code}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonClasses("primary", "md")}>
          Create
        </button>
      </Form>

      {/* List */}
      {activities.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          No activities yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {activities.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 p-4">
              <Link to={`/admin/activities/${a.id}`} className="flex min-w-0 flex-col">
                <span className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{a.name}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[a.status] ?? ""}`}
                  >
                    {a.status}
                  </span>
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {activityKindLabel(a.kind)} · {a.startsAt ? new Date(a.startsAt).toLocaleDateString() : "—"}
                  {" – "}
                  {a.endsAt ? new Date(a.endsAt).toLocaleDateString() : "—"} ·{" "}
                  {a.participantCount} participants · {a.eventCount} events
                </span>
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                <Form method="post">
                  <input type="hidden" name="intent" value="clone" />
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit" className={buttonClasses("ghost", "sm")}>
                    Clone
                  </button>
                </Form>
                <Link to={`/admin/activities/${a.id}`} className={buttonClasses("secondary", "sm")}>
                  Edit
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
