// Admin → Onboarding (specs/activities.md §7.8). Lists all activities and
// creates a new one (name + mechanic + term; the window defaults and is refined
// on the detail page). Distinct from the audit log.

import { useEffect, useState } from "react";
import { Form, Link, redirect, useActionData, useLoaderData, useNavigation } from "react-router";
import { Copy, Pencil, Plus } from "lucide-react";
import type { Route } from "./+types/admin.activities";
import { AdminSectionHeader, adminHandle } from "~/admin/adminNav";
import { EmptyState, Pill, type Tone } from "~/admin/components/console-ui";
import { useOsChrome } from "~/components/os-chrome";
import { Modal } from "~/components/Modal";
import { Select, Tooltip } from "~/components/ui/floating";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isAdmin, isCore } from "~/lib/roles";
import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { cn } from "~/lib/cn";
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

export const handle = adminHandle("onboarding");

export const meta: Route.MetaFunction = () => [
  { title: "Onboarding · Admin · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const [activities, terms, viewerIsAdmin] = await Promise.all([
    listActivitiesForAdmin(),
    prisma.term.findMany({ orderBy: { sortKey: "desc" }, select: { id: true, code: true } }),
    isAdmin(auth.user.sub),
  ]);
  return { activities, terms, viewerIsAdmin };
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
    return redirect(`/admin/onboarding/${clone.id}`);
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
  return redirect(`/admin/onboarding/${created.id}`);
}

const STATUS_TONE: Record<string, Tone> = {
  Draft: "warn",
  Published: "ok",
  Archived: "idle",
};

function formatDate(d: string | Date | null): string {
  return d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
}

function NewActivityModal({
  open,
  onClose,
  terms,
}: {
  open: boolean;
  onClose: () => void;
  terms: { id: string; code: string }[];
}) {
  const { formClass, formTrigger, fieldLabel, actionBtn, actionBtnPrimary, sectionTitle } = useOsChrome();
  const actionData = useActionData<typeof action>() as { error?: string } | undefined;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting" && navigation.formData?.get("intent") === "create";
  return (
    <Modal open={open} onClose={onClose} labelledBy="new-activity-title">
      <Form method="post" className={cn(formClass, "flex flex-col gap-4")}>
        <input type="hidden" name="intent" value="create" />
        <h2 id="new-activity-title" className={sectionTitle}>
          New activity
        </h2>
        <label className={fieldLabel}>
          Name
          <input type="text" name="name" required placeholder="Fall onboarding hunt" />
        </label>
        <label className={fieldLabel}>
          Type
          <Select
            name="kind"
            ariaLabel="Type"
            defaultValue={ACTIVITY_KINDS[0]?.kind}
            options={ACTIVITY_KINDS.map((k) => ({ value: k.kind, label: k.label }))}
            buttonClassName={formTrigger}
          />
        </label>
        <label className={fieldLabel}>
          Term
          <Select
            name="termId"
            ariaLabel="Term"
            defaultValue=""
            options={[{ value: "", label: "None" }, ...terms.map((t) => ({ value: t.id, label: t.code }))]}
            buttonClassName={formTrigger}
          />
        </label>
        <p className="text-xs text-os-muted">It starts now and runs for a week. Change the window after.</p>
        {actionData?.error && <p className="text-sm text-destructive">{actionData.error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={actionBtn()}>
            Cancel
          </button>
          <button type="submit" disabled={submitting} className={cn(actionBtnPrimary, "disabled:opacity-50")}>
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </Form>
    </Modal>
  );
}

export default function AdminActivities() {
  const { activities, terms } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>() as { error?: string } | undefined;
  const { panel, sectionTitle, iconBtn } = useOsChrome();
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (actionData?.error) setCreating(true);
  }, [actionData]);

  return (
    <div className="flex flex-col gap-8">
      <AdminSectionHeader section="onboarding" />

      <section className="flex flex-col gap-3" aria-labelledby="activities-title">
        <div className="flex items-end justify-between gap-4">
          <h2 id="activities-title" className={sectionTitle}>
            Activities
          </h2>
          <button type="button" className="os-add-btn" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" strokeWidth={3} /> New activity
          </button>
        </div>

        {activities.length === 0 ? (
          <div className={panel}>
            <EmptyState title="No activities yet">
              Create one, then publish it to run it.
            </EmptyState>
          </div>
        ) : (
          <ul className={panel}>
            {activities.map((a, i) => (
              <li
                key={a.id}
                className={cn(
                  "grid gap-4 px-6 py-5 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center",
                  i > 0 && "border-t border-os-container/70",
                )}
              >
                <Link to={`/admin/onboarding/${a.id}`} className="group min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground group-hover:text-os-accent">{a.name}</span>
                    <Pill tone={STATUS_TONE[a.status] ?? "idle"}>{a.status}</Pill>
                  </span>
                  <span className="mt-0.5 block text-sm text-os-grey">
                    {activityKindLabel(a.kind)} · {formatDate(a.startsAt)} to {formatDate(a.endsAt)}
                  </span>
                </Link>
                <div className="text-sm">
                  <p className="text-xs text-os-muted">Participants</p>
                  <p className="tabular-nums text-foreground">{a.participantCount}</p>
                </div>
                <div className="text-sm">
                  <p className="text-xs text-os-muted">Events</p>
                  <p className="tabular-nums text-foreground">{a.eventCount}</p>
                </div>
                <div className="flex items-center gap-1 md:justify-end">
                  <Form method="post">
                    <input type="hidden" name="intent" value="clone" />
                    <input type="hidden" name="id" value={a.id} />
                    <Tooltip content="Clone">
                      <button type="submit" aria-label={`Clone ${a.name}`} className={iconBtn}>
                        <Copy className="h-4 w-4" />
                      </button>
                    </Tooltip>
                  </Form>
                  <Tooltip content="Edit">
                    <Link to={`/admin/onboarding/${a.id}`} aria-label={`Edit ${a.name}`} className={iconBtn}>
                      <Pencil className="h-4 w-4" />
                    </Link>
                  </Tooltip>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <NewActivityModal open={creating} onClose={() => setCreating(false)} terms={terms} />
    </div>
  );
}
