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
import { isCore, canViewStaffing } from "~/lib/roles";
import { projectsPills } from "../components/projectsPills";
import { AreaPillNav } from "~/components/AreaPillNav";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import { prisma } from "~/lib/db";
import { resolvePhotoUrl } from "~/lib/photo";
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
import { Globe } from "lucide-react";
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

  const { terms, selected, termId, isAll } = await resolveTermFilter(request);

  const projects = await prisma.project.findMany({
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
      // by sortKey and take the first.
      projectTerms: {
        select: { term: { select: { code: true, sortKey: true } } },
      },
      partners: {
        select: { partnerOrg: { select: { name: true, logoUrl: true } } },
      },
      showcase: { select: { status: true } },
    },
  });

  const rows: ProjectRow[] = await Promise.all(
    projects.map(async (p) => {
      const startTerm = p.projectTerms
        .map((pt) => pt.term)
        .sort((a, b) => a.sortKey - b.sortKey)[0];
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

  const [partnerOrgs, canEdit, canStaff, myAssignments, totalProjects] =
    await Promise.all([
      prisma.partnerOrg.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      isCore(auth.user.sub),
      canViewStaffing(auth.user.sub),
      // Which projects the viewer has (or had) an assignment on, any term —
      // drives the "My projects" toggle chip.
      prisma.projectAssignment.findMany({
        where: { userId: auth.user.sub },
        select: { projectId: true },
        distinct: ["projectId"],
      }),
      // Only needed to tell "the term filter hid everything" apart from "no
      // projects at all"; with the filter off, rows already is everything.
      filteringByTerm ? prisma.project.count() : Promise.resolve(0),
    ]);

  return {
    rows,
    terms,
    selectedTerm: selected,
    partnerOrgs,
    canEdit,
    canStaff,
    myProjectIds: myAssignments.map((a) => a.projectId),
    hiddenByTermFilter: filteringByTerm && rows.length === 0 && totalProjects > 0,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;
  if (!(await isCore(auth.user.sub))) {
    return { error: "You don't have permission to create projects." };
  }

  const form = await request.formData();
  const name = (form.get("name") as string | null)?.trim() ?? "";
  const description = (form.get("description") as string | null)?.trim() ?? "";
  const iconEmoji = (form.get("iconEmoji") as string | null)?.trim() ?? "";
  const status = (form.get("status") as string | null) ?? "Active";
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
    myProjectIds,
    hiddenByTermFilter,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [newIconEmoji, setNewIconEmoji] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  // In the URL (like ?term=) rather than component state, so "show me every
  // project still needing a write-up" is a link someone can share.
  const showcaseFilter = searchParams.get("public") ?? SHOWCASE_FILTER_ALL;
  const [view, setView] = useViewPreference("dali:view:projects", "list");

  const filtered = useMemo(() => {
    const mine = new Set(myProjectIds);
    let base = mineOnly ? rows.filter((r) => mine.has(r.id)) : rows;
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
  }, [rows, query, mineOnly, myProjectIds, showcaseFilter]);

  return (
    <div className="flex flex-col gap-4">
      <AreaPillNav items={projectsPills({ canViewStaffing: canStaff, active: "hub" })} />
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">
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
            className={buttonClasses("primary", "sm")}
          >
            + New project
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
              className={buttonClasses("ghost", "sm")}
            >
              Cancel
            </button>
            <button type="submit" className={buttonClasses("primary", "sm")}>
              Create
            </button>
          </div>
        </Form>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by project or partner name"
          className="flex-1 min-w-[200px] max-w-sm px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        />
        <button
          type="button"
          onClick={() => setMineOnly((v) => !v)}
          aria-pressed={mineOnly}
          className={`inline-flex items-center text-xs px-2.5 py-1 rounded-full border transition-colors ${
            mineOnly
              ? "border-accent-coral bg-accent-coral/10 text-accent-coral"
              : "border-border text-muted-foreground hover:bg-muted/30"
          }`}
        >
          My projects
        </button>
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
            buttonClassName="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground sm:w-40 inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
          />
        </label>
        <ViewToggle value={view} onChange={setView} />
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} {filtered.length === 1 ? "project" : "projects"}
          {(query || mineOnly || showcaseFilter !== SHOWCASE_FILTER_ALL) &&
          filtered.length !== rows.length
            ? ` of ${rows.length}`
            : ""}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          {query ? (
            "No projects match this search."
          ) : mineOnly && rows.length > 0 ? (
            "You're not on any of these projects."
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
      ) : view === "list" ? (
        <ProjectsTable rows={filtered} />
      ) : (
        <ProjectsCards rows={filtered} />
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

function ProjectsCards({ rows }: { rows: ProjectRow[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {rows.map((p) => (
        <ProjectCard key={p.id} project={p} />
      ))}
    </div>
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
