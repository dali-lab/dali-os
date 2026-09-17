import { redirect, useLoaderData, Link, useFetcher } from "react-router";
import { redirectToLogin } from "~/lib/login-next";
import type { Route } from "./+types/education.manage";
import { requireAuth, forbidden } from "~/lib/auth";
import { getUserRoles, isCore } from "~/lib/roles";
import { listManageable, runOfferingAction } from "~/education/lib/offerings.server";
import { OfferingCard } from "~/education/components/OfferingCard";
import { buttonClasses } from "~/components/ui/Button";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { FilterPill } from "~/components/ui/filter-panel";
import { useEffect, useMemo, useState } from "react";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";

export const meta: Route.MetaFunction = () => [
  { title: "Manage Education · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);

  const roles = await getUserRoles(auth.user.sub);
  // Non-managers (incl. a Dartmouth non-member who isn't an instructor) go to
  // their /portal home — not /education, which bounces non-members straight back.
  if (!roles.isCore && !roles.isInstructor) return redirect("/portal");

  return {
    offerings: await listManageable(auth.user.sub),
    isCore: roles.isCore,
    isExternal: !roles.isLabMember,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) return forbidden(request);

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (
    intent !== "duplicate-offering" &&
    intent !== "set-status" &&
    intent !== "delete-offering"
  ) {
    return Response.json({ error: "Unknown intent" }, { status: 400 });
  }

  const result = await runOfferingAction(formData, auth.user.sub);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status ?? 400 });
  }

  if (intent === "duplicate-offering" && result.id) {
    return redirect(`/education/manage/${result.id}`);
  }

  return Response.json({ ok: true });
}

// Offerings are sliced by their own dates, not by a term: an offering has
// finished once its last session has ended.
type Scope = "upcoming" | "past" | "all";

const SCOPES: [Scope, string][] = [
  ["upcoming", "Upcoming"],
  ["past", "Past"],
  ["all", "All"],
];

export default function ManageEducation() {
  const { offerings, isCore, isExternal } = useLoaderData<typeof loader>();
  const certTemplatesOn = useFeatureFlag("certificate-templates");
  const fetcher = useFetcher<{ error?: string; ok?: boolean }>();
  const dialog = useDialog();
  const toast = useToast();

  // Surface fetcher errors as toasts (set-status / delete-offering failures).
  useEffect(() => {
    if (fetcher.data && "error" in fetcher.data && fetcher.data.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.data, toast]);

  // Instructors/Core plan ahead, so default to what hasn't finished — history
  // is a click away. A draft with no sessions yet has no endsAt and counts as
  // upcoming rather than vanishing from the default view.
  const [scope, setScope] = useState<Scope>("upcoming");
  const filtered = useMemo(() => {
    if (scope === "all") return offerings;
    const now = Date.now();
    const hasEnded = (o: (typeof offerings)[number]) =>
      o.endsAt != null && new Date(o.endsAt).getTime() < now;
    return offerings.filter((o) => (scope === "past" ? hasEnded(o) : !hasEnded(o)));
  }, [offerings, scope]);

  async function handleDuplicate(offeringId: string, offeringTitle: string) {
    const raw = await dialog.prompt({
      title: `Duplicate "${offeringTitle}"`,
      description:
        "Enter the date and time for the first session of the new copy. Leave blank to copy dates as-is.",
      label: "First session date & time",
      placeholder: "e.g. 2026-10-01T18:00",
      confirmLabel: "Duplicate",
    });
    if (raw === null) return; // cancelled

    const fd = new FormData();
    fd.set("intent", "duplicate-offering");
    fd.set("offeringId", offeringId);
    if (raw.trim()) fd.set("firstSessionDate", raw.trim());
    fetcher.submit(fd, { method: "post" });
  }

  async function handleArchive(offeringId: string, currentStatus: string) {
    const isArchived = currentStatus === "Archived";
    if (!isArchived) {
      const ok = await dialog.confirm({
        title: "Archive offering?",
        description: "The offering will be hidden from the catalog but not deleted.",
        confirmLabel: "Archive",
        tone: "default",
      });
      if (!ok) return;
    }
    const fd = new FormData();
    fd.set("intent", "set-status");
    fd.set("offeringId", offeringId);
    fd.set("status", isArchived ? "Published" : "Archived");
    fetcher.submit(fd, { method: "post" });
  }

  async function handleDelete(offeringId: string, offeringTitle: string) {
    const ok = await dialog.confirm({
      title: `Delete "${offeringTitle}"?`,
      description: "This permanently deletes the draft and cannot be undone.",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!ok) return;
    const fd = new FormData();
    fd.set("intent", "delete-offering");
    fd.set("offeringId", offeringId);
    fetcher.submit(fd, { method: "post" });
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            Manage education
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isCore
              ? "All offerings, drafts included. Create a new offering or open one to edit sessions, review applications, and take attendance."
              : "Offerings you teach. Open one to edit sessions, review applications, and take attendance."}
          </p>
        </div>
        {isCore && (
          <div className="flex items-center gap-2 shrink-0">
            {certTemplatesOn && (
              <Link
                to="/education/certificate-templates"
                className={buttonClasses("secondary", "sm")}
              >
                Certificate templates
              </Link>
            )}
            <Link to="/education/manage/new" className={buttonClasses("primary", "sm")}>
              New offering
            </Link>
          </div>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by date">
        {SCOPES.map(([value, label]) => (
          <FilterPill
            key={value}
            os
            selected={scope === value}
            onClick={() => setScope(value)}
          >
            {label}
          </FilterPill>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <p className="font-heading font-semibold text-foreground">
            No offerings yet
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {scope !== "all"
              ? `No ${scope} offerings. Try "All" or create a new one.`
              : isCore
                ? 'Create the first miniseries or workshop with "New offering".'
                : "You'll see offerings here once Core assigns you as an instructor."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((o) => (
            <OfferingCard
              key={o.id}
              offering={o}
              showStatus
              pendingCount={o.pendingCount}
              to={`/education/manage/${o.id}`}
              isCore={isCore}
              onDuplicate={() => handleDuplicate(o.id, o.title)}
              onArchive={() => handleArchive(o.id, o.status)}
              onDelete={() => handleDelete(o.id, o.title)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
