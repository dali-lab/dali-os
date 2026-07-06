import {
  redirect,
  useLoaderData,
  useActionData,
  useSearchParams,
  Form,
  Link,
} from "react-router";
import type { Route } from "./+types/education.manage.$offeringId";
import { requireAuth } from "~/lib/auth";
import { isCore, currentTermMemberWhere } from "~/lib/roles";
import {
  requireOfferingManager,
  redirectDartmouthToPortal,
} from "~/education/lib/access.server";
import {
  getOfferingDetail,
  runOfferingAction,
} from "~/education/lib/offerings.server";
import { prisma } from "~/lib/db";
import { parseSessionCookie } from "~/lib/cookies";
import { Button, buttonClasses } from "~/components/ui/Button";
import { TypeBadge, StatusBadge } from "~/education/components/OfferingCard";
import { OfferingFields, toDatetimeLocal } from "~/education/components/OfferingFields";
import { CollaborativeEditor } from "~/components/CollaborativeEditor";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { formatDateTime } from "~/lib/display";
import { cn } from "~/lib/cn";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `Manage ${data?.offering.title ?? "Offering"} · DALI OS` },
];

export const handle = {
  breadcrumb: (data: { offering: { title: string } } | undefined) =>
    data?.offering.title ?? "Offering",
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const authOrRedirect = await requireAuth(request);
  if (!authOrRedirect.ok) return redirect("/login");
  const portalRedirect = redirectDartmouthToPortal(authOrRedirect);
  if (portalRedirect) return portalRedirect;

  const gate = await requireOfferingManager(request, params.offeringId!);
  if (!gate.ok) return redirect("/education");

  const offering = await getOfferingDetail(params.offeringId!);
  if (!offering) throw new Response("Not found", { status: 404 });

  const core = await isCore(gate.auth.user.sub);
  const instructorCandidates = core
    ? await prisma.user.findMany({
        where: await currentTermMemberWhere(),
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      })
    : [];

  return {
    offering,
    isCore: core,
    instructorCandidates: instructorCandidates.map((u) => ({
      id: u.id,
      name: `${u.firstName} ${u.lastName}`.trim(),
    })),
    collabToken: parseSessionCookie(request),
    userName: `${gate.auth.user.firstName ?? ""} ${gate.auth.user.lastName ?? ""}`.trim(),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const formData = await request.formData();
  // Pin the offering id from the URL so a form can't retarget another offering.
  formData.set("offeringId", params.offeringId!);
  const result = await runOfferingAction(formData, auth.user.sub);
  if ("error" in result)
    return Response.json({ error: result.error }, { status: result.status });
  if (formData.get("intent") === "delete-offering") return redirect("/education/manage");
  return result;
}

const TABS = [
  { key: "details", label: "Details" },
  { key: "sessions", label: "Sessions" },
] as const;

export default function ManageOffering() {
  const {
    offering,
    isCore: core,
    instructorCandidates,
    collabToken,
    userName,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<{ error?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") ?? "details";

  const nextStatuses: { to: string; label: string; variant: "primary" | "secondary" | "destructive" }[] =
    offering.status === "Draft"
      ? [{ to: "Published", label: "Publish", variant: "primary" }]
      : offering.status === "Published"
        ? [
            { to: "Draft", label: "Unpublish", variant: "secondary" },
            { to: "Archived", label: "Archive", variant: "destructive" },
          ]
        : [{ to: "Published", label: "Re-publish", variant: "secondary" }];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <TypeBadge type={offering.type} />
            <StatusBadge status={offering.status} />
          </div>
          <h1 className="mt-1 font-heading text-2xl font-bold text-foreground">
            {offering.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {offering.approvedCount} of {offering.capacity} seats filled
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to={`/education/${offering.id}`}
            className={buttonClasses("ghost", "sm")}
          >
            View listing
          </Link>
          {nextStatuses.map((s) => (
            <Form key={s.to} method="post">
              <input type="hidden" name="intent" value="set-status" />
              <input type="hidden" name="status" value={s.to} />
              <Button type="submit" variant={s.variant} size="sm">
                {s.label}
              </Button>
            </Form>
          ))}
        </div>
      </header>

      {actionData?.error && (
        <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
          {actionData.error}
        </p>
      )}

      <nav className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setSearchParams({ tab: t.key }, { preventScrollReset: true })}
            className={cn(
              "px-4 py-2 text-sm font-semibold rounded-t-md",
              tab === t.key
                ? "text-accent-coral border-b-2 border-accent-coral"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "details" && (
        <div className="flex flex-col gap-6 max-w-2xl">
          <Form
            method="post"
            className="bg-card border border-border rounded-lg p-5 flex flex-col gap-4"
          >
            <input type="hidden" name="intent" value="update-offering" />
            <OfferingFields values={offering} typeLocked />
            <div>
              <Button type="submit" size="sm">
                Save details
              </Button>
            </div>
          </Form>

          <section className="bg-card border border-border rounded-lg p-5">
            <h2 className="text-sm font-semibold text-foreground mb-1">
              Description
            </h2>
            <p className="text-xs text-muted-foreground mb-3">
              Shown on the catalog listing. Edits save live.
            </p>
            {collabToken && offering.descriptionDocId ? (
              <PresenceProvider
                pageId={`eduoffering:${offering.id}`}
                token={collabToken}
                userName={userName}
              >
                <CollaborativeEditor
                  editorId={offering.descriptionDocId}
                  documentName={offering.descriptionDocId}
                  token={collabToken}
                  userName={userName}
                  placeholder="What this offering covers, who it's for, what attendees build…"
                  className="border border-border rounded-md"
                />
              </PresenceProvider>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                Sign in again to edit the description.
              </p>
            )}
          </section>

          {core && (
            <Form
              method="post"
              className="bg-card border border-border rounded-lg p-5"
            >
              <input type="hidden" name="intent" value="set-instructors" />
              <h2 className="text-sm font-semibold text-foreground mb-1">
                Instructors
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                Instructors can edit this offering, review applications, and
                take attendance.
              </p>
              <div className="grid gap-1 sm:grid-cols-2 max-h-64 overflow-y-auto pr-2">
                {instructorCandidates.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      name="userIds"
                      value={u.id}
                      defaultChecked={offering.instructors.some((i) => i.userId === u.id)}
                      className="rounded border-border"
                    />
                    {u.name}
                  </label>
                ))}
              </div>
              <div className="mt-3">
                <Button type="submit" variant="secondary" size="sm">
                  Save instructors
                </Button>
              </div>
            </Form>
          )}

          {core && offering.status === "Draft" && (
            <Form
              method="post"
              onSubmit={(e) => {
                if (!confirm("Delete this draft offering? This can't be undone.")) {
                  e.preventDefault();
                }
              }}
            >
              <input type="hidden" name="intent" value="delete-offering" />
              <Button type="submit" variant="destructive" size="sm">
                Delete draft
              </Button>
            </Form>
          )}
        </div>
      )}

      {tab === "sessions" && (
        <div className="flex flex-col gap-4 max-w-2xl">
          {offering.sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              No sessions yet.{" "}
              {offering.type === "Miniseries"
                ? "A miniseries needs at least one session before it can publish."
                : "Add the workshop's session below."}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {offering.sessions.map((s) => (
                <li key={s.id} className="bg-card border border-border rounded-lg p-4">
                  <div className="flex items-center justify-between gap-4 mb-3">
                    <p className="text-sm font-semibold text-foreground">
                      Session {s.sequence}
                      <span className="ml-2 font-normal text-muted-foreground text-xs">
                        {formatDateTime(s.datetime)}
                      </span>
                    </p>
                    <Form
                      method="post"
                      onSubmit={(e) => {
                        if (!confirm("Delete this session?")) e.preventDefault();
                      }}
                    >
                      <input type="hidden" name="intent" value="delete-session" />
                      <input type="hidden" name="sessionId" value={s.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        Delete
                      </Button>
                    </Form>
                  </div>
                  <Form method="post" className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] items-end">
                    <input type="hidden" name="intent" value="update-session" />
                    <input type="hidden" name="sessionId" value={s.id} />
                    <label className="block">
                      <span className="text-xs font-semibold text-muted-foreground">When</span>
                      <input
                        type="datetime-local"
                        name="datetime"
                        required
                        defaultValue={toDatetimeLocal(s.datetime)}
                        className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-muted-foreground">Location</span>
                      <input
                        type="text"
                        name="location"
                        defaultValue={s.location ?? ""}
                        className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold text-muted-foreground">Recording URL</span>
                      <input
                        type="url"
                        name="recordingUrl"
                        defaultValue={s.recordingUrl ?? ""}
                        className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                      />
                    </label>
                    <Button type="submit" variant="secondary" size="sm">
                      Save
                    </Button>
                  </Form>
                </li>
              ))}
            </ul>
          )}

          <Form
            method="post"
            className="bg-card border border-border rounded-lg p-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end"
          >
            <input type="hidden" name="intent" value="add-session" />
            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground">When</span>
              <input
                type="datetime-local"
                name="datetime"
                required
                className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground">Location</span>
              <input
                type="text"
                name="location"
                placeholder="Sudikoff 007"
                className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              />
            </label>
            <Button type="submit" size="sm">
              Add session
            </Button>
          </Form>
        </div>
      )}
    </div>
  );
}
