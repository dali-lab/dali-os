import { redirect, useLoaderData, Link, useSearchParams, useFetcher } from "react-router";
import { redirectToLogin } from "~/lib/login-next";
import type { Route } from "./+types/education.manage";
import { requireAuth, forbidden } from "~/lib/auth";
import { getUserRoles, isCore, currentTerm } from "~/lib/roles";
import { redirectDartmouthToPortal } from "~/education/lib/access.server";
import { listManageable, runOfferingAction } from "~/education/lib/offerings.server";
import { OfferingCard } from "~/education/components/OfferingCard";
import { educationPills } from "~/education/components/educationPills";
import { AreaPillNav } from "~/components/AreaPillNav";
import { buttonClasses } from "~/components/ui/Button";
import { Select } from "~/components/ui/floating";
import { prisma } from "~/lib/db";
import { useEffect } from "react";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";

export const handle = { areaPills: true };

export const meta: Route.MetaFunction = () => [
  { title: "Manage Education · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectDartmouthToPortal(auth);
  if (portalRedirect) return portalRedirect;

  const roles = await getUserRoles(auth.user.sub);
  if (!roles.isCore && !roles.isInstructor) return redirect("/education");

  const [offerings, terms, activeTerm] = await Promise.all([
    listManageable(auth.user.sub),
    prisma.term.findMany({
      orderBy: { sortKey: "asc" },
      select: { id: true, code: true, sortKey: true, startDate: true, endDate: true },
    }),
    currentTerm(request),
  ]);

  const url = new URL(request.url);
  const selectedTermId = url.searchParams.get("term") ?? "all";

  return {
    offerings,
    isCore: roles.isCore,
    terms,
    currentTermId: activeTerm?.id ?? null,
    selectedTermId,
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

export default function ManageEducation() {
  const { offerings, isCore, terms, currentTermId, selectedTermId } =
    useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const fetcher = useFetcher<{ error?: string; ok?: boolean }>();
  const dialog = useDialog();
  const toast = useToast();

  // Surface fetcher errors as toasts (set-status / delete-offering failures).
  useEffect(() => {
    if (fetcher.data && "error" in fetcher.data && fetcher.data.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.data, toast]);

  const termOptions: { value: string; label: string }[] = [
    { value: "all", label: "All terms" },
    ...terms.map((t) => ({
      value: t.id,
      label: t.id === currentTermId ? `${t.code} · current` : t.code,
    })),
  ];

  const filtered =
    selectedTermId === "all"
      ? offerings
      : offerings.filter((o) => o.termId === selectedTermId);

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
      <AreaPillNav
        items={educationPills({ canManage: true, isCore, active: "manage" })}
      />
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
          <Link to="/education/manage/new" className={buttonClasses("primary", "sm")}>
            New offering
          </Link>
        )}
      </header>

      {/* Term filter */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground shrink-0">Term</span>
        <Select
          value={selectedTermId}
          options={termOptions}
          onChange={(v) => {
            if (v === "all") {
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete("term");
                return next;
              });
            } else {
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.set("term", v);
                return next;
              });
            }
          }}
          ariaLabel="Filter by term"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <p className="font-heading font-semibold text-foreground">
            No offerings yet
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {selectedTermId !== "all"
              ? 'No offerings for this term. Try "All terms" or create a new one.'
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
