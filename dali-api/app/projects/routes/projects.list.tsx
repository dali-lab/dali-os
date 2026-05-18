import { useMemo, useState } from "react";
import { Link, redirect, useLoaderData, useNavigate } from "react-router";
import type { Route } from "./+types/projects.list";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { ViewToggle, useViewPreference } from "~/components/ViewToggle";

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
  if (auth.user.type === "applicant") return redirect("/portal");

  const projects = await prisma.project.findMany({
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      status: true,
      imageUrl: true,
      firstTerm: { select: { code: true } },
      partners: {
        select: { partnerOrg: { select: { name: true, logoUrl: true } } },
      },
    },
  });

  const rows: ProjectRow[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    firstTermCode: p.firstTerm?.code ?? null,
    imageUrl: p.imageUrl,
    partners: p.partners.map((pp) => ({
      name: pp.partnerOrg.name,
      logoUrl: pp.partnerOrg.logoUrl,
    })),
  }));

  return { rows };
}

export default function ProjectsListPage() {
  const { rows } = useLoaderData<typeof loader>();
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
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">Projects</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every DALI project, with status and partners.
        </p>
      </header>

      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by project or partner name"
          className="flex-1 min-w-[200px] max-w-sm px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        />
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
              onClick={() => navigate(`/projects/${p.id}`)}
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
    Active: "bg-accent-teal/15 text-accent-teal",
    Paused: "bg-muted text-foreground",
    Archived: "bg-muted/50 text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded ${palette[status]}`}
    >
      {status}
    </span>
  );
}
