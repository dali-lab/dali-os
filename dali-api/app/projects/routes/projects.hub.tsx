import { useMemo, useState } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigate,
} from "react-router";
import type { Route } from "./+types/projects.hub";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { isCore, canViewStaffing } from "~/lib/roles";
import { projectsPills } from "../components/projectsPills";
import { AreaPillNav } from "~/components/AreaPillNav";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import { prisma } from "~/lib/db";
import { githubTeamSlug } from "~/lib/github-slug";
import { ensureProjectGroup } from "~/lib/groups";
import { ViewToggle, useViewPreference } from "~/components/ViewToggle";
import { TermFilter } from "~/components/TermFilter";
import { resolveTermFilter } from "~/lib/terms";

export const handle = { areaPills: true };

export const meta: Route.MetaFunction = () => [{ title: "Projects · DALI OS" }];

type ProjectStatus = "Active" | "Paused" | "Archived";

type ProjectPartnerOut = {
  name: string;
  logoUrl: string | null;
};

type ProjectRow = {
  id: string;
  name: string;
  status: ProjectStatus;
  firstTermCode: string | null;
  imageUrl: string | null;
  partners: ProjectPartnerOut[];
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;

  const { terms, selected, termId, isAll } = await resolveTermFilter(request);

  const projects = await prisma.project.findMany({
    // A term filter scopes to Active projects that run in the selected term —
    // i.e. the term is in the project's ProjectTerm set — since a project may
    // span several terms. Paused/Archived are noise for a term view. "All
    // terms" drops the filter entirely and stays the full archive view.
    where:
      isAll || !termId
        ? undefined
        : { projectTerms: { some: { termId } }, status: "Active" },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
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
    },
  });

  const rows: ProjectRow[] = projects.map((p) => {
    const startTerm = p.projectTerms
      .map((pt) => pt.term)
      .sort((a, b) => a.sortKey - b.sortKey)[0];
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      firstTermCode: startTerm?.code ?? null,
      imageUrl: p.imageUrl,
      partners: p.partners.map((pp) => ({
        name: pp.partnerOrg.name,
        logoUrl: pp.partnerOrg.logoUrl,
      })),
    };
  });

  const [partnerOrgs, canEdit, canStaff] = await Promise.all([
    prisma.partnerOrg.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    isCore(auth.user.sub),
    canViewStaffing(auth.user.sub),
  ]);

  return { rows, terms, selectedTerm: selected, partnerOrgs, canEdit, canStaff };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;
  if (!(await isCore(auth.user.sub))) {
    return { error: "You don't have permission to create projects." };
  }

  const form = await request.formData();
  const name = (form.get("name") as string | null)?.trim() ?? "";
  const description = (form.get("description") as string | null)?.trim() ?? "";
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
  const { rows, terms, selectedTerm, partnerOrgs, canEdit, canStaff } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useViewPreference("dali:view:projects", "list");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      if (r.name.toLowerCase().includes(q)) return true;
      return r.partners.some((p) => p.name.toLowerCase().includes(q));
    });
  }, [rows, query]);

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
            onClick={() => setCreating(true)}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs sm:col-span-2">
              <span className="text-muted-foreground">
                Name<span className="text-destructive"> *</span>
              </span>
              <input
                name="name"
                autoFocus
                required
                placeholder="Project name"
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              />
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
              <select
                name="status"
                defaultValue="Active"
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              >
                <option value="Active">Active</option>
                <option value="Paused">Paused</option>
                <option value="Archived">Archived</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Start term</span>
              <select
                name="firstTermId"
                defaultValue=""
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              >
                <option value="">No start term</option>
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs sm:col-span-2">
              <span className="text-muted-foreground">Partner (optional)</span>
              <select
                name="partnerOrgId"
                defaultValue=""
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              >
                <option value="">No partner</option>
                {partnerOrgs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
            >
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
        <TermFilter terms={terms} selected={selectedTerm} />
        <ViewToggle value={view} onChange={setView} />
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} {filtered.length === 1 ? "project" : "projects"}
          {query && filtered.length !== rows.length ? ` of ${rows.length}` : ""}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          {query ? "No projects match this search." : "No projects yet."}
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
              onClick={() => {
                const url = `/projects/${p.id}`;
                if (!requestOpenTabIfEmbedded(url, p.name)) navigate(url);
              }}
              className="border-t border-border hover:bg-muted/20 cursor-pointer"
            >
              <td className="px-4 py-2 text-foreground">{p.name}</td>
              <td className="px-4 py-2">
                <StatusPill status={p.status} />
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
      {project.imageUrl && (
        <img
          src={project.imageUrl}
          alt=""
          className="w-full h-28 object-cover border-b border-border"
        />
      )}
      <div className="flex flex-col gap-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold text-foreground truncate">{project.name}</span>
        <StatusPill status={project.status} />
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
