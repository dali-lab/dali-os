import { useMemo, useState } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigate,
  useSearchParams,
} from "react-router";
import { Select } from "~/components/ui/floating";
import type { Route } from "./+types/projects.hub";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import {
  captureProjectTemplate,
  instantiateProjectTemplate,
} from "~/lib/project-templates.server";
import { projectsPills } from "../components/projectsPills";
import { AreaPillNav } from "~/components/AreaPillNav";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import { prisma } from "~/lib/db";
import { resolvePhotoUrl } from "~/lib/photo";
import { timed } from "~/lib/server-timing";
import { githubTeamSlug } from "~/lib/github-slug";
import { ensureProjectGroup } from "~/lib/groups";
import { ViewToggle, useViewPreference } from "~/components/ViewToggle";
import { buttonClasses } from "~/components/ui/Button";
import { TermFilter } from "~/components/TermFilter";
import { resolveTermFilter } from "~/lib/terms";
import { ALL_TERMS } from "~/lib/terms.shared";
import { ProjectCoverImage } from "~/projects/components/ProjectCoverImage";
import { ProjectIcon } from "~/components/ProjectIcon";
import { ProjectIconPicker } from "~/projects/components/ProjectIconPicker";
import { Globe, Plus } from "lucide-react";
import { cn } from "~/lib/cn";
import { filterPillClass } from "~/components/ui/floating/styles";
import { useFeatureFlag } from "~/components/FeatureFlags";
import {
  matchesShowcaseFilter,
  SHOWCASE_FILTER_ALL,
  SHOWCASE_FILTER_NONE,
  type ShowcaseStatusValue,
} from "../lib/showcase-filter";

export const handle = {
  areaPills: true,
  docKey: "projects.hub",
  docTitle: "Projects",
};

export const meta: Route.MetaFunction = () => [{ title: "Projects · DALI OS" }];

type ProjectStatus = "Active" | "Paused" | "Archived";

// "none" is its own filter value, not a showcase status: a project whose Public
// view has never been opened has no row at all, and "which projects has nobody
// written up yet" is the question this filter gets asked most.
const SHOWCASE_FILTERS: { value: string; label: string }[] = [
  { value: SHOWCASE_FILTER_ALL, label: "Any" },
  { value: "Published", label: "Published" },
  { value: "NeedsReview", label: "Needs review" },
  { value: "InProgress", label: "In progress" },
  { value: "NotStarted", label: "Not started" },
  { value: "Archive", label: "Archived" },
  { value: SHOWCASE_FILTER_NONE, label: "Not written up" },
];

const SHOWCASE_LABELS: Record<ShowcaseStatusValue, string> = {
  Published: "Published",
  NeedsReview: "Needs review",
  InProgress: "In progress",
  NotStarted: "Not started",
  Archive: "Archived",
};

type ProjectPartnerOut = {
  name: string;
  logoUrl: string | null;
};

type ProjectRow = {
  id: string;
  name: string;
  iconEmoji: string | null;
  status: ProjectStatus;
  firstTermCode: string | null;
  imageUrl: string | null;
  partners: ProjectPartnerOut[];
  // Publication state of the project's public showcase card, or null when it
  // has none yet. Distinct from `status`, which is the internal lifecycle.
  showcaseStatus: ShowcaseStatusValue | null;
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;

  const { terms, selected, termId, isAll } = await timed(request, 'hub.terms', () =>
    resolveTermFilter(request));

  const projects = await timed(request, 'hub.projects', () => prisma.project.findMany({
    // A term filter scopes to projects that run in the selected term — i.e. the
    // term is in the project's ProjectTerm set — since a project may span
    // several terms. Status is deliberately not part of the filter: most of the
    // lab's history is Archived, so excluding it made past terms read as empty.
    // The status pill on each card carries that distinction instead.
    where:
      isAll || !termId ? undefined : { projectTerms: { some: { termId } } },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      iconEmoji: true,
      status: true,
      imageUrl: true,
      // Start term is derived as the earliest term in the set. Fetch ascending
      // by sortKey and take the first row only — Postgres returns one row
      // rather than the full set.
      projectTerms: {
        orderBy: { term: { sortKey: "asc" } },
        take: 1,
        select: { term: { select: { code: true, sortKey: true } } },
      },
      partners: {
        select: { partnerOrg: { select: { name: true, logoUrl: true } } },
      },
      showcase: { select: { status: true } },
    },
  }));

  const rows: ProjectRow[] = await Promise.all(
    projects.map(async (p) => {
      // projectTerms is already ordered asc by sortKey and limited to 1 row.
      const startTerm = p.projectTerms[0]?.term;
      return {
        id: p.id,
        name: p.name,
        iconEmoji: p.iconEmoji,
        status: p.status,
        firstTermCode: startTerm?.code ?? null,
        // Uploaded images are stored as S3 keys; presign for display.
        imageUrl: await resolvePhotoUrl(p.imageUrl),
        partners: await Promise.all(
          p.partners.map(async (pp) => ({
            name: pp.partnerOrg.name,
            logoUrl: await resolvePhotoUrl(pp.partnerOrg.logoUrl),
          })),
        ),
        showcaseStatus: p.showcase?.status ?? null,
      };
    }),
  );

  const filteringByTerm = !isAll && !!termId;

  // getUserRoles(sub, request) resolves isCore and canViewStaffing in one cached
  // round-trip — no second hit even though canViewStaffing delegates to isCore.
  const [roles, partnerOrgs, totalProjects] =
    await timed(request, 'hub.meta', () => Promise.all([
      getUserRoles(auth.user.sub, request),
      prisma.partnerOrg.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      // Only needed to tell "the term filter hid everything" apart from "no
      // projects at all"; with the filter off, rows already is everything.
      filteringByTerm ? prisma.project.count() : Promise.resolve(0),
    ]));
  const canEdit = roles.isCore;
  const canStaff = roles.canViewStaffing;

  // Project templates (Core + `templates` flag): the "Start from template"
  // options in the create modal. Reuses the `roles` resolved above.
  const templatesEnabled = canEdit && (await isFeatureEnabled("templates", auth.user.sub, roles, request));
  const projectTemplates = templatesEnabled
    ? await prisma.projectTemplate.findMany({
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
        select: { id: true, name: true, iconEmoji: true },
      })
    : [];

  return {
    rows,
    terms,
    selectedTerm: selected,
    partnerOrgs,
    canEdit,
    canStaff,
    hiddenByTermFilter: filteringByTerm && rows.length === 0 && totalProjects > 0,
    templatesEnabled,
    projectTemplates,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;
  const actionRoles = await getUserRoles(auth.user.sub, request);
  if (!actionRoles.isCore) {
    return { error: "You don't have permission to create projects." };
  }

  const form = await request.formData();
  const intent = (form.get("intent") as string | null) ?? "create";

  // Capture: save an existing project's structure as a template (posted from
  // the project page's "Save as template" control). Gated by the flag.
  if (intent === "capture") {
    if (!(await isFeatureEnabled("templates", auth.user.sub, actionRoles, request))) {
      return { error: "Templates are not enabled." };
    }
    const projectId = (form.get("projectId") as string | null)?.trim() ?? "";
    const templateName = (form.get("templateName") as string | null)?.trim() ?? "";
    if (!projectId || !templateName) return { error: "A project and template name are required." };
    try {
      await captureProjectTemplate({
        projectId,
        name: templateName,
        description: (form.get("templateDescription") as string | null) ?? null,
        createdBy: auth.user.sub,
        includeOverviewPage: form.get("includeOverviewPage") === "on",
      });
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Could not save template." };
    }
    return redirect(`/projects/${projectId}`);
  }

  const name = (form.get("name") as string | null)?.trim() ?? "";
  const description = (form.get("description") as string | null)?.trim() ?? "";
  const iconEmoji = (form.get("iconEmoji") as string | null)?.trim() ?? "";
  const status = (form.get("status") as string | null) ?? "Active";

  // Start from template: when the create modal picked a template, build the new
  // project from its blueprint instead of a blank one.
  const fromTemplateId = (form.get("fromTemplateId") as string | null)?.trim() ?? "";
  if (fromTemplateId) {
    if (!(await isFeatureEnabled("templates", auth.user.sub, actionRoles, request))) {
      return { error: "Templates are not enabled." };
    }
    if (!name) return { error: "A project name is required." };
    const initialTermId = (form.get("firstTermId") as string | null)?.trim() || null;
    const partnerOrgId = (form.get("partnerOrgId") as string | null)?.trim() || null;
    try {
      const created = await instantiateProjectTemplate({
        templateId: fromTemplateId,
        name,
        createdBy: auth.user.sub,
        initialTermId,
        partnerOrgId,
      });
      return redirect(`/projects/${created.id}`);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Could not create from template." };
    }
  }
  // The create form's term picker seeds the project's first term. The term set
  // is then editable on the detail page; the start term is derived as the
  // earliest member.
  const initialTermId = (form.get("firstTermId") as string | null)?.trim() ?? "";
  const partnerOrgId = (form.get("partnerOrgId") as string | null)?.trim() ?? "";

  if (!name) return { error: "A project name is required." };
  const STATUSES: ProjectStatus[] = ["Active", "Paused", "Archived"];
  if (!STATUSES.includes(status as ProjectStatus)) {
    return { error: "Invalid status." };
  }
  if (initialTermId) {
    const term = await prisma.term.findUnique({
      where: { id: initialTermId },
      select: { id: true },
    });
    if (!term) return { error: "That term no longer exists." };
  }
  if (partnerOrgId) {
    const org = await prisma.partnerOrg.findUnique({
      where: { id: partnerOrgId },
      select: { id: true },
    });
    if (!org) return { error: "That partner no longer exists." };
  }

  const created = await prisma.project.create({
    data: {
      name,
      // Auto-derive the GitHub team slug from the name (editable later on the
      // project page). Enables the roster→team sync without a manual step.
      githubTeamSlug: githubTeamSlug(name) || null,
      description: description === "" ? null : description,
      iconEmoji: iconEmoji === "" ? null : iconEmoji,
      status: status as ProjectStatus,
      // Seed the initial term into the project's term set (if chosen).
      ...(initialTermId
        ? { projectTerms: { create: { termId: initialTermId } } }
        : {}),
      // Optionally link a partner up front; further partners are managed on
      // the project detail page.
      ...(partnerOrgId
        ? { partners: { create: { partnerOrgId } } }
        : {}),
    },
    select: { id: true, name: true },
  });
  await ensureProjectGroup(created.id, created.name);
  return redirect(`/projects/${created.id}`);
}

export default function ProjectsListPage() {
  const {
    rows,
    terms,
    selectedTerm,
    partnerOrgs,
    canEdit,
    canStaff,
    hiddenByTermFilter,
    templatesEnabled,
    projectTemplates,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [newIconEmoji, setNewIconEmoji] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // In the URL (like ?term=) rather than component state, so "show me every
  // project still needing a write-up" is a link someone can share.
  const showcaseFilter = searchParams.get("public") ?? SHOWCASE_FILTER_ALL;
  // The dali.os hub is this same page in the design's dress — the title scales
  // up, the toolbar controls become pills, and the card view takes the cover-led
  // layout. Every control keeps its behaviour; nothing here is flag-only.
  const os = useFeatureFlag("os-redesign");
  // Only consulted with the flag off — the os hub has one view. Left on the
  // shared "dali:view:projects" key so a member's list/card choice survives
  // being shown the design and taken back off it.
  const [view, setView] = useViewPreference("dali:view:projects", "list");

  const filtered = useMemo(() => {
    let base = rows;
    if (showcaseFilter !== SHOWCASE_FILTER_ALL) {
      base = base.filter((r) =>
        matchesShowcaseFilter(r.showcaseStatus, showcaseFilter),
      );
    }
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((r) => {
      if (r.name.toLowerCase().includes(q)) return true;
      return r.partners.some((p) => p.name.toLowerCase().includes(q));
    });
  }, [rows, query, showcaseFilter]);

  return (
    <div className="flex flex-col gap-4">
      <AreaPillNav items={projectsPills({ canViewStaffing: canStaff, active: "hub" })} />
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1
            className={cn(
              "font-heading text-foreground",
              os ? "text-[40px] font-medium" : "text-2xl font-bold",
            )}
          >
            Projects
          </h1>
        </div>
        {canEdit && !creating && (
          <button
            type="button"
            onClick={() => {
              setNewIconEmoji(null);
              setCreating(true);
            }}
            className={os ? "os-add-btn" : buttonClasses("primary", "sm")}
          >
            {os ? (
              <>
                <Plus className="h-[17px] w-[17px]" strokeWidth={3} aria-hidden />
                New project
              </>
            ) : (
              "+ New project"
            )}
          </button>
        )}
      </header>

      {actionData?.error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {actionData.error}
        </div>
      )}

      {creating && canEdit && (
        <Form
          method="post"
          onSubmit={() => setCreating(false)}
          className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3"
        >
          <h2 className="text-sm font-semibold text-foreground">New project</h2>
          <input type="hidden" name="iconEmoji" value={newIconEmoji ?? ""} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs sm:col-span-2">
              <span className="text-muted-foreground">
                Name<span className="text-destructive"> *</span>
              </span>
              <div className="flex items-center gap-2">
                <ProjectIconPicker iconEmoji={newIconEmoji} editing onChange={setNewIconEmoji} />
                <input
                  name="name"
                  autoFocus
                  required
                  placeholder="Project name"
                  className="flex-1 px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                />
              </div>
            </label>
            <label className="flex flex-col gap-1 text-xs sm:col-span-2">
              <span className="text-muted-foreground">Description</span>
              <textarea
                name="description"
                rows={2}
                placeholder="Short blurb shown at the top of the project page."
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              />
            </label>
            {templatesEnabled && projectTemplates.length > 0 && (
              <label className="flex flex-col gap-1 text-xs sm:col-span-2">
                <span className="text-muted-foreground">Start from template (optional)</span>
                <Select
                  name="fromTemplateId"
                  defaultValue=""
                  placeholder="Blank project"
                  options={[
                    { value: "", label: "Blank project" },
                    ...projectTemplates.map((t) => ({
                      value: t.id,
                      label: `${t.iconEmoji ? `${t.iconEmoji} ` : ""}${t.name}`,
                    })),
                  ]}
                  buttonClassName="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
                />
                <span className="text-[11px] text-muted-foreground">
                  Copies the template's epics, sprints, and tasks into the new project.
                </span>
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Status</span>
              <Select
                name="status"
                defaultValue="Active"
                options={[
                  { value: "Active", label: "Active" },
                  { value: "Paused", label: "Paused" },
                  { value: "Archived", label: "Archived" },
                ]}
                buttonClassName="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Start term</span>
              <Select
                name="firstTermId"
                defaultValue=""
                placeholder="No start term"
                options={[
                  { value: "", label: "No start term" },
                  ...terms.map((t) => ({ value: t.id, label: t.code })),
                ]}
                buttonClassName="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs sm:col-span-2">
              <span className="text-muted-foreground">Partner (optional)</span>
              <Select
                name="partnerOrgId"
                defaultValue=""
                placeholder="No partner"
                options={[
                  { value: "", label: "No partner" },
                  ...partnerOrgs.map((p) => ({ value: p.id, label: p.name })),
                ]}
                buttonClassName="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
              />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setNewIconEmoji(null);
                setCreating(false);
              }}
              className={os ? "os-btn-ghost" : buttonClasses("ghost", "sm")}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={os ? "os-btn-primary" : buttonClasses("primary", "sm")}
            >
              Create
            </button>
          </div>
        </Form>
      )}

      <div className={cn("flex items-center gap-3 flex-wrap", os && "gap-4 pt-2 pb-4")}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by project or partner name"
          className={cn(
            "flex-1 min-w-[200px] border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30",
            os
              ? "max-w-[420px] min-w-[260px] px-5 py-3 text-base rounded-3xl bg-card"
              : "max-w-sm px-3 py-2 rounded-md bg-background",
          )}
        />
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          Term
          <TermFilter terms={terms} selected={selectedTerm} />
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          Website
          <Select
            value={showcaseFilter}
            onChange={(value) => {
              const next = new URLSearchParams(searchParams);
              if (value === SHOWCASE_FILTER_ALL) next.delete("public");
              else next.set("public", value);
              setSearchParams(next);
            }}
            ariaLabel="Filter by status on dali.website"
            options={SHOWCASE_FILTERS.map((f) => ({ value: f.value, label: f.label }))}
            buttonClassName={cn(filterPillClass(os), "w-full sm:w-40")}
          />
        </label>
        {/* The design has one view of this page, the card grid — so the
            list/card toggle is gone with it. The table view and the toggle
            are still what the current hub renders with the flag off. */}
        {!os && <ViewToggle value={view} onChange={setView} />}
        <span className={cn("ml-auto text-muted-foreground", os ? "text-base" : "text-xs")}>
          {filtered.length} {filtered.length === 1 ? "project" : "projects"}
          {(query || showcaseFilter !== SHOWCASE_FILTER_ALL) &&
          filtered.length !== rows.length
            ? ` of ${rows.length}`
            : ""}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          {query ? (
            "No projects match this search."
          ) : showcaseFilter !== SHOWCASE_FILTER_ALL && rows.length > 0 ? (
            <>
              No projects have that public status.{" "}
              <button
                type="button"
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.delete("public");
                  setSearchParams(next);
                }}
                className="font-medium text-accent-coral hover:underline"
              >
                Clear the filter
              </button>
            </>
          ) : hiddenByTermFilter ? (
            // Projects exist — the default current-term filter just hides them
            // all. Say so, and offer the one-click way out.
            <>
              No projects run in this term.{" "}
              <button
                type="button"
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.set("term", ALL_TERMS);
                  setSearchParams(next);
                }}
                className="font-medium text-accent-coral hover:underline"
              >
                Show all terms
              </button>
            </>
          ) : (
            "No projects yet."
          )}
        </div>
      ) : !os && view === "list" ? (
        <ProjectsTable rows={filtered} />
      ) : (
        <ProjectsCards rows={filtered} os={os} />
      )}
    </div>
  );
}

function ProjectsTable({ rows }: { rows: ProjectRow[] }) {
  const navigate = useNavigate();
  const open = (p: ProjectRow) => {
    const url = `/projects/${p.id}`;
    if (!requestOpenTabIfEmbedded(url, p.name)) navigate(url);
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left font-medium px-4 py-2">Name</th>
            <th className="text-left font-medium px-4 py-2">Status</th>
            <th className="text-left font-medium px-4 py-2">Partners</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr
              key={p.id}
              onClick={() => open(p)}
              className="border-t border-border hover:bg-muted/20 cursor-pointer"
            >
              <td className="px-4 py-2">
                <div className="flex items-center gap-3 min-w-0">
                  <ProjectThumb project={p} />
                  <ProjectIcon iconEmoji={p.iconEmoji} />
                  {/* A real anchor so cmd/ctrl/middle-click opens a browser
                      tab; a plain click defers to the row's embed-aware
                      handler (same behavior as clicking anywhere else). */}
                  <Link
                    to={`/projects/${p.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                      e.preventDefault();
                      open(p);
                    }}
                    className="text-foreground truncate hover:underline"
                  >
                    {p.name}
                  </Link>
                </div>
              </td>
              <td className="px-4 py-2">
                <div className="flex items-center gap-1.5">
                  <StatusPill status={p.status} />
                  <PublicPill status={p.showcaseStatus} />
                </div>
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {p.partners.length > 0 ? p.partners.map((pp) => pp.name).join(", ") : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProjectsCards({ rows, os = false }: { rows: ProjectRow[]; os?: boolean }) {
  if (os) {
    return (
      // auto-fill rather than fixed columns: the design's cards hold their
      // 280px minimum and the row simply fits fewer of them as the pane
      // narrows, which is what a split-screen workspace tab needs.
      <div className="grid max-w-[1080px] grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
        {rows.map((p) => (
          <OsProjectCard key={p.id} project={p} />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {rows.map((p) => (
        <ProjectCard key={p.id} project={p} />
      ))}
    </div>
  );
}

/* The design's project card: cover-led, with the status riding the image and
   the term and partner reduced to one line each. Same fields as ProjectCard —
   status, publication state, term, partners — so nothing the list view can tell
   you is missing here; only the emphasis changes. */
function OsProjectCard({ project }: { project: ProjectRow }) {
  const [first, ...restPartners] = project.partners;
  return (
    // Hover: lift and shadow move together so the card reads as rising rather
    // than sliding, and the cover scales on a slower curve than the frame so
    // the two don't land on the same beat. Hover-in is quicker (200ms) than
    // the settle back out (300ms), which is what keeps it from feeling stepped.
    <Link
      to={`/projects/${project.id}`}
      className="group flex flex-col overflow-hidden rounded-os-card bg-os-card transition-[background-color,transform,box-shadow] duration-300 ease-[cubic-bezier(0.2,0.8,0.3,1)] hover:bg-os-card-hover hover:shadow-[0_12px_28px_-12px_rgba(0,0,0,0.6)] hover:duration-200 motion-safe:hover:-translate-y-1"
    >
      <div className="relative overflow-hidden">
        <ProjectCoverImage
          name={project.name}
          imageUrl={project.imageUrl}
          className="h-[183px] w-full object-cover transition-transform duration-500 ease-out motion-safe:group-hover:scale-[1.04]"
          placeholderClassName="h-[183px] w-full transition-transform duration-500 ease-out motion-safe:group-hover:scale-[1.04]"
        />
        <div className="absolute right-3 top-3 flex items-center gap-1.5">
          <PublicPill status={project.showcaseStatus} />
          <OsStatusTag status={project.status} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-[17px]">
        <span className="flex min-w-0 items-center gap-1.5 text-xl text-white">
          <ProjectIcon iconEmoji={project.iconEmoji} size="inherit" />
          <span className="truncate">{project.name}</span>
        </span>
        {project.firstTermCode && (
          <span className="flex items-center gap-2">
            <span className="rounded-full bg-os-container px-3 py-1 text-xs font-semibold text-white">
              {project.firstTermCode}
            </span>
            <span className="text-xs text-os-grey">Start term</span>
          </span>
        )}
        <span className="mt-auto flex min-w-0 items-center gap-2.5 text-sm text-os-grey">
          {first ? (
            <>
              {first.logoUrl ? (
                <img
                  src={first.logoUrl}
                  alt=""
                  className="h-5 w-5 flex-shrink-0 rounded-full object-contain"
                />
              ) : (
                <span className="h-5 w-5 flex-shrink-0 rounded-full bg-os-container" />
              )}
              <span className="truncate">{first.name}</span>
              {restPartners.length > 0 && (
                <span
                  className="flex-shrink-0 text-xs"
                  title={restPartners.map((p) => p.name).join(", ")}
                >
                  +{restPartners.length}
                </span>
              )}
            </>
          ) : (
            <span className="text-os-muted">No partners</span>
          )}
        </span>
      </div>
    </Link>
  );
}

// The design's status tag: a translucent plate over the cover so it reads on
// any photo, tinted per status the same way StatusPill is.
function OsStatusTag({ status }: { status: ProjectStatus }) {
  const palette: Record<ProjectStatus, string> = {
    Active: "text-os-green border-os-green/35",
    Archived: "text-os-grey border-os-grey/35",
    Paused: "text-os-amber border-os-amber/35",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border bg-os-bg/85 px-3 py-[5px] text-xs font-semibold ${palette[status]}`}
    >
      {status}
    </span>
  );
}

function ProjectCard({ project }: { project: ProjectRow }) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="border border-border rounded-md bg-background flex flex-col gap-2 overflow-hidden hover:bg-muted/10 transition-colors"
    >
      <ProjectCoverImage
        name={project.name}
        imageUrl={project.imageUrl}
        className="w-full h-28 object-cover border-b border-border"
        placeholderClassName="w-full h-28"
      />
      <div className="flex flex-col gap-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5 min-w-0 font-semibold text-foreground">
          <ProjectIcon iconEmoji={project.iconEmoji} />
          <span className="truncate">{project.name}</span>
        </span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <StatusPill status={project.status} />
          <PublicPill status={project.showcaseStatus} />
        </div>
      </div>
      {project.firstTermCode && (
        <div className="text-xs text-muted-foreground">Start term {project.firstTermCode}</div>
      )}
      {project.partners.length === 0 ? (
        <div className="text-xs text-muted-foreground">No partners</div>
      ) : (
        <div className="flex flex-wrap gap-2 mt-1">
          {project.partners.map((p) => (
            <PartnerChip key={p.name} partner={p} />
          ))}
        </div>
      )}
      </div>
    </Link>
  );
}

// Row thumbnail for the list view. Falls back to the project's initial so the
// name column stays aligned whether or not an image is set — same shape as the
// partners hub's OrgAvatar, but object-cover since these are photos, not logos.
function ProjectThumb({
  project,
}: {
  project: Pick<ProjectRow, "name" | "imageUrl">;
}) {
  if (project.imageUrl) {
    return (
      <img
        src={project.imageUrl}
        alt=""
        className="w-8 h-8 rounded object-cover bg-background border border-border flex-shrink-0"
      />
    );
  }
  return (
    <div className="w-8 h-8 rounded bg-brand-tint text-dark-blue flex items-center justify-center text-xs font-bold flex-shrink-0">
      {project.name.slice(0, 1)}
    </div>
  );
}

function PartnerChip({ partner }: { partner: ProjectPartnerOut }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs rounded bg-muted text-foreground">
      {partner.logoUrl && (
        <img src={partner.logoUrl} alt="" className="w-3.5 h-3.5 rounded-sm object-contain" />
      )}
      {partner.name}
    </span>
  );
}

// Marks a project as live on dali.website. Only Published gets a badge: it's
// the state with consequences outside the lab, and badging all five would put a
// second pill on every row in a list that is mostly not published. The filter
// covers the other states.
function PublicPill({ status }: { status: ShowcaseStatusValue | null }) {
  if (status !== "Published") return null;
  return (
    <span
      title="Published on dali.website"
      className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded border bg-accent-coral/10 text-accent-coral border-accent-coral/40"
    >
      <Globe className="w-3 h-3" />
      {SHOWCASE_LABELS.Published}
    </span>
  );
}

function StatusPill({ status }: { status: ProjectStatus }) {
  const palette: Record<ProjectStatus, string> = {
    Active: "bg-accent-teal/15 text-accent-teal border-accent-teal/40",
    Paused: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/40",
    Archived: "bg-muted/50 text-muted-foreground border-border",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border ${palette[status]}`}
    >
      {status}
    </span>
  );
}
