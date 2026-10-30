import { useMemo, useState } from "react";
import {
  Form,
  Link,
  redirect,
  type ShouldRevalidateFunctionArgs,
  useActionData,
  useLoaderData,
  useNavigate,
  useSearchParams,
} from "react-router";
import { Select } from "~/components/ui/floating";
import type { Route } from "./+types/projects.hub";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { currentTerm, getUserRoles } from "~/lib/roles";
import { termFilterOrder } from "~/lib/terms.shared";
import {
  captureProjectTemplate,
  instantiateProjectTemplate,
} from "~/lib/project-templates.server";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import { prisma } from "~/lib/db.server";
import { resolvePhotoUrl } from "~/lib/photo";
import { timed } from "~/lib/server-timing";
import { githubTeamSlug } from "~/lib/github-slug";
import { ensureProjectGroup } from "~/lib/groups";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import {
  listProvisionTargets,
  provisionProjectInfra,
  provisionRequestFromForm,
  type ProvisionTargets,
} from "~/lib/infra/provision.server";
import { NewProjectInfraFields } from "~/projects/components/NewProjectInfraFields";
import { ViewToggle, useViewPreference } from "~/components/ViewToggle";
import { buttonClasses } from "~/components/ui/Button";
import { ProjectCoverImage } from "~/projects/components/ProjectCoverImage";
import { ProjectIcon } from "~/components/ProjectIcon";
import { ProjectIconPicker } from "~/projects/components/ProjectIconPicker";
import { CalendarRange, CircleDot, Globe, Handshake, Plus } from "lucide-react";
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { SearchInput } from "~/components/ui/SearchInput";
import {
  ColumnFilters,
  useColumnFilters,
  type FilterColumn,
} from "~/projects/components/ColumnFilters";
import type { ColumnFilter } from "~/projects/lib/submission-filters";
import {
  SHOWCASE_FILTER_NONE,
  type ShowcaseStatusValue,
} from "../lib/showcase-filter";

export const handle = {
  docKey: "projects.hub",
  docTitle: "Projects",
};

export const meta: Route.MetaFunction = () => [{ title: "Projects · DALI OS" }];

type ProjectStatus = "Active" | "Paused" | "Archived";

// The filter bar's columns (the People page's advanced filter). "Not written
// up" is the website column's value for a project with no showcase row at all:
// "which projects has nobody written up yet" is the question that column gets
// asked most.
function filterColumns(
  terms: readonly { code: string }[],
  currentTermCode: string | null,
): FilterColumn[] {
  return [
    { key: "status", label: "Status", icon: CircleDot },
    // A project matches a term when it's anywhere in the ProjectTerm set — a
    // project may span several terms. Status is deliberately a separate column:
    // most of the lab's history is Archived, so folding it into Term made past
    // terms read as empty.
    {
      key: "term",
      label: "Term",
      icon: CalendarRange,
      order: termFilterOrder(
        terms.map((t) => ({ id: t.code, code: t.code, isCurrent: t.code === currentTermCode })),
        { includeAll: false },
      ).map((o) => o.value),
      optionLabel: (code) => (code === currentTermCode ? `${code} (current)` : code),
    },
    { key: "website", label: "Website", icon: Globe },
    { key: "partner", label: "Partner", icon: Handshake },
  ];
}

const NO_SHOWCASE_LABEL = "Not written up";

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
  termCodes: string[];
  imageUrl: string | null;
  partners: ProjectPartnerOut[];
  // Publication state of the project's public showcase card, or null when it
  // has none yet. Distinct from `status`, which is the internal lifecycle.
  showcaseStatus: ShowcaseStatusValue | null;
};

export function shouldRevalidate({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (formMethod && formMethod.toUpperCase() !== "GET") return defaultShouldRevalidate;
  // The loader reads no search params (?new= and ?public= are client-only),
  // so a search-only change never needs a reload.
  if (currentUrl.pathname === nextUrl.pathname && currentUrl.search !== nextUrl.search) {
    return false;
  }
  return defaultShouldRevalidate;
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = await redirectNonMemberToPortal(auth, request);
  if (portalRedirect) return portalRedirect;

  // The create modal's "Start term" picker. Term *filtering* happens client-side
  // in the advanced filter bar, off each row's term set.
  const [terms, current] = await timed(request, 'hub.terms', () =>
    Promise.all([
      prisma.term.findMany({
        orderBy: { sortKey: "desc" },
        select: { id: true, code: true },
      }),
      currentTerm(request),
    ]));

  const projects = await timed(request, 'hub.projects', () => prisma.project.findMany({
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      iconEmoji: true,
      status: true,
      imageUrl: true,
      // The full term set, ascending: the first row is the derived start term,
      // and every code feeds the Term column of the filter bar.
      projectTerms: {
        orderBy: { term: { sortKey: "asc" } },
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
      return {
        id: p.id,
        name: p.name,
        iconEmoji: p.iconEmoji,
        status: p.status,
        firstTermCode: p.projectTerms[0]?.term.code ?? null,
        termCodes: p.projectTerms.map((pt) => pt.term.code),
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

  // getUserRoles(sub, request) resolves isCore and canViewStaffing in one cached
  // round-trip — no second hit even though canViewStaffing delegates to isCore.
  const [roles, partnerOrgs] =
    await timed(request, 'hub.meta', () => Promise.all([
      getUserRoles(auth.user.sub, request),
      prisma.partnerOrg.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]));
  const canEdit = roles.isCore;
  const canStaff = roles.canViewStaffing;

  // Project templates (Core only): the "Start from template" options in the
  // create modal.
  const projectTemplates = canEdit
    ? await prisma.projectTemplate.findMany({
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
        select: { id: true, name: true, iconEmoji: true },
      })
    : [];

  // Admin only: optional starting infra on the create form.
  const provisionTargets: ProvisionTargets | null =
    roles.isAdmin && (await isFeatureEnabled("infra-dashboard", auth.user.sub, roles, request))
      ? await listProvisionTargets()
      : null;

  return {
    rows,
    terms,
    currentTermCode: current?.code ?? null,
    partnerOrgs,
    canEdit,
    canStaff,
    projectTemplates,
    provisionTargets,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = await redirectNonMemberToPortal(auth, request);
  if (portalRedirect) return portalRedirect;
  const actionRoles = await getUserRoles(auth.user.sub, request);
  if (!actionRoles.isCore) {
    return { error: "You don't have permission to create projects." };
  }

  const form = await request.formData();
  const intent = (form.get("intent") as string | null) ?? "create";

  // Capture: save an existing project's structure as a template (posted from
  // the project page's "Save as template" control). Core-gated above.
  if (intent === "capture") {
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

  // Optional starting infra runs after the project exists; a failed step lands
  // on the new project's Infrastructure section instead of blocking the create.
  const canProvision =
    actionRoles.isAdmin && (await isFeatureEnabled("infra-dashboard", auth.user.sub, actionRoles, request));
  const openCreated = async (projectId: string) => {
    const want = canProvision ? provisionRequestFromForm(form, name, githubTeamSlug(name)) : {};
    const { errors } = await provisionProjectInfra({ userId: auth.user.sub, projectId, request, want });
    const qs = errors.length ? `?infraErrors=${encodeURIComponent(errors.join("\n"))}` : "";
    return redirect(`/projects/${projectId}${qs}`);
  };
  const iconEmoji = (form.get("iconEmoji") as string | null)?.trim() ?? "";
  const status = (form.get("status") as string | null) ?? "Active";

  // Start from template: when the create modal picked a template, build the new
  // project from its blueprint instead of a blank one.
  const fromTemplateId = (form.get("fromTemplateId") as string | null)?.trim() ?? "";
  if (fromTemplateId) {
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
      return openCreated(created.id);
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
  return openCreated(created.id);
}

export default function ProjectsListPage() {
  const {
    rows,
    terms,
    currentTermCode,
    partnerOrgs,
    canEdit,
    canStaff,
    projectTemplates,
    provisionTargets,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  // Deep link from the Drive templates gallery: ?new=<templateId> opens the
  // create modal prefilled with that project template.
  const presetTemplateId = searchParams.get("new") ?? "";
  const [creating, setCreating] = useState(() => canEdit && presetTemplateId !== "");
  const [newIconEmoji, setNewIconEmoji] = useState<string | null>(null);
  const startCreating = () => {
    setNewIconEmoji(null);
    setCreating(true);
  };
  const [query, setQuery] = useState("");
  const [view, setView] = useViewPreference("dali:view:projects", "list");

  // An old ?public= link (from the Drive templates gallery era of this filter)
  // opens with the matching Website filter already in the builder; an unknown
  // value is ignored so a stale link just shows everything.
  const publicParam = searchParams.get("public");
  const linkedWebsite =
    publicParam === SHOWCASE_FILTER_NONE
      ? NO_SHOWCASE_LABEL
      : (SHOWCASE_LABELS[publicParam as ShowcaseStatusValue] ?? null);
  const initialFilters: ColumnFilter[] = [
    ...(currentTermCode ? [{ columnKey: "term", values: [currentTermCode] }] : []),
    ...(linkedWebsite ? [{ columnKey: "website", values: [linkedWebsite] }] : []),
  ];
  const columns = useMemo(() => filterColumns(terms, currentTermCode), [terms, currentTermCode]);

  const filterRows = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        cells: {
          status: r.status,
          term: r.termCodes,
          website: r.showcaseStatus ? SHOWCASE_LABELS[r.showcaseStatus] : NO_SHOWCASE_LABEL,
          partner: r.partners.map((p) => p.name),
        },
      })),
    [rows],
  );

  const columnFilters = useColumnFilters(columns, initialFilters);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return filterRows.filter((r) => {
      if (!columnFilters.predicate(r)) return false;
      if (!q) return true;
      if (r.name.toLowerCase().includes(q)) return true;
      return r.partners.some((p) => p.name.toLowerCase().includes(q));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterRows, query, columnFilters.active]);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-3">
        <h1
          className={cn(
            "min-w-0 font-heading text-foreground",
            "text-[40px] font-medium",
          )}
        >
          Projects
        </h1>
      </header>

      {actionData?.error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {actionData.error}
        </div>
      )}

      <Modal
        open={creating && canEdit}
        onClose={() => {
          setNewIconEmoji(null);
          setCreating(false);
        }}
        labelledBy="new-project-title"
        containerClassName={modalCardClass("max-w-xl")}
      >
        <ModalHeader
          titleId="new-project-title"
          title="New project"
          onClose={() => {
            setNewIconEmoji(null);
            setCreating(false);
          }}
        />
        <Form method="post" onSubmit={() => setCreating(false)} className="flex flex-col gap-3">
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
                  className="flex-1 px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-os-accent/30"
                />
              </div>
            </label>
            <label className="flex flex-col gap-1 text-xs sm:col-span-2">
              <span className="text-muted-foreground">Description</span>
              <textarea
                name="description"
                rows={2}
                placeholder="Short blurb shown at the top of the project page."
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-os-accent/30"
              />
            </label>
            {projectTemplates.length > 0 && (
              <label className="flex flex-col gap-1 text-xs sm:col-span-2">
                <span className="text-muted-foreground">Start from template (optional)</span>
                <Select
                  name="fromTemplateId"
                  defaultValue={presetTemplateId}
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
          {provisionTargets && <NewProjectInfraFields targets={provisionTargets} />}
          <ModalFooter
            onCancel={() => {
              setNewIconEmoji(null);
              setCreating(false);
            }}
          >
            <button type="submit" className="os-btn-primary">
              Create
            </button>
          </ModalFooter>
        </Form>
      </Modal>

      <div className={cn("flex items-center gap-3 flex-wrap", "gap-4 pt-2 pb-4")}>
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by project or partner name"
          containerClassName="flex-1 min-w-[260px] max-w-[420px]"
        />
        <div className="min-w-[220px] flex-1">
          <ColumnFilters
            columns={columns}
            rows={filterRows}
            filters={columnFilters.filters}
            onChange={columnFilters.setFilters}
            shownCount={filtered.length}
            noun={["project", "projects"]}
          />
        </div>
      </div>

      {filtered.length === 0 && !(rows.length === 0 && canEdit) ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          {query ? (
            "No projects match this search."
          ) : columnFilters.active.length > 0 && rows.length > 0 ? (
            <>
              No projects match these filters.{" "}
              <button
                type="button"
                onClick={() => columnFilters.setFilters([])}
                className="font-medium text-os-accent hover:underline"
              >
                Clear the filters
              </button>
            </>
          ) : (
            "No projects yet."
          )}
        </div>
      ) : (
        <ProjectsCards rows={filtered} onNew={canEdit ? startCreating : undefined} />
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
        <thead className="bg-muted/30 text-muted-foreground text-xs">
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
                  <OsStatusTag status={p.status} />
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

function ProjectsCards({ rows, onNew }: { rows: ProjectRow[]; onNew?: () => void }) {
  return (
    // auto-fill rather than fixed columns: the design's cards hold their
    // 280px minimum and the row simply fits fewer of them as the pane
    // narrows, which is what a split-screen workspace tab needs. No width
    // cap on the grid — one left the cards short of the pane's right edge on
    // a wide window, with the filter row above still running full width.
    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
      {rows.map((p) => (
        <OsProjectCard key={p.id} project={p} />
      ))}
      {onNew && (
        <button
          type="button"
          onClick={onNew}
          className="flex min-h-[290px] flex-col items-center justify-center gap-2 rounded-os-card border-2 border-dashed border-os-container bg-transparent text-os-grey transition-colors hover:border-os-container-hi hover:bg-os-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/60"
        >
          <Plus className="h-6 w-6" aria-hidden />
          <span className="text-sm font-medium">New project</span>
        </button>
      )}
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
      className="group flex flex-col overflow-hidden rounded-os-card bg-os-card transition-[background-color,transform,box-shadow] duration-300 ease-[cubic-bezier(0.2,0.8,0.3,1)] hover:bg-os-card-hover hover:shadow-[0_12px_28px_-10px_var(--color-os-shadow)] hover:duration-200 motion-safe:hover:-translate-y-1"
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
        <span className="flex min-w-0 items-center gap-1.5 text-xl text-foreground">
          <ProjectIcon iconEmoji={project.iconEmoji} size="inherit" />
          <span className="truncate">{project.name}</span>
        </span>
        {project.firstTermCode && (
          <span className="flex items-center gap-2">
            <span className="rounded-full bg-os-container px-3 py-1 text-xs font-semibold text-foreground">
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

// One plate for every chip a project wears — its status and its publication
// state alike. They sit side by side in the corner of a card's cover, so a
// difference between them is visible as a difference: they used to disagree
// about padding, corner radius and weight all at once.
const PROJECT_CHIP =
  "inline-flex items-center gap-1 rounded-full border bg-os-bg/85 px-3 py-[5px] text-xs font-semibold";

// The design's status tag: a translucent plate that reads on any photo, tinted
// per status.
function OsStatusTag({ status }: { status: ProjectStatus }) {
  const palette: Record<ProjectStatus, string> = {
    Active: "text-os-green border-os-green/35",
    Archived: "text-os-grey border-os-grey/35",
    Paused: "text-os-amber border-os-amber/35",
  };
  return <span className={`${PROJECT_CHIP} ${palette[status]}`}>{status}</span>;
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
          <OsStatusTag status={project.status} />
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
    <div className="w-8 h-8 rounded bg-os-well text-foreground flex items-center justify-center text-xs font-bold flex-shrink-0">
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
      className={`${PROJECT_CHIP} border-os-accent/35 text-os-accent`}
    >
      <Globe className="h-3 w-3" />
      {SHOWCASE_LABELS.Published}
    </span>
  );
}
