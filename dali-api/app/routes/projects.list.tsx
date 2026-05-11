import { useMemo, useState } from "react";
import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/projects.list";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { FolderKanban, LayoutGrid, List, Search } from "lucide-react";

export const meta: Route.MetaFunction = () => [{ title: "Projects · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return withAuth(auth, redirect("/login"));
  if (auth.user.type === "applicant") return withAuth(auth, redirect("/portal"));

  const projects = await prisma.project.findMany({
    include: {
      partners: { include: { partnerOrg: { select: { id: true, name: true } } } },
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });

  return withAuth(auth, { projects });
}

type ViewMode = "list" | "card";
type StatusFilter = "all" | "Active" | "Paused" | "Archived";

const STATUS_STYLES: Record<string, string> = {
  Active: "bg-green-100 text-green-800",
  Paused: "bg-amber-100 text-amber-800",
  Archived: "bg-gray-200 text-gray-700",
};

export default function ProjectsList() {
  const { projects } = useLoaderData<typeof loader>();
  const [view, setView] = useState<ViewMode>("list");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [partnerFilter, setPartnerFilter] = useState<string>("all");

  const allPartners = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) {
      for (const pp of p.partners) {
        map.set(pp.partnerOrg.id, pp.partnerOrg.name);
      }
    }
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [projects]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (
        partnerFilter !== "all" &&
        !p.partners.some((pp) => pp.partnerOrg.id === partnerFilter)
      )
        return false;
      if (q) {
        const hay = [
          p.name,
          ...p.partners.map((pp) => pp.partnerOrg.name),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [projects, search, statusFilter, partnerFilter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <FolderKanban className="w-6 h-6 text-foreground/80" />
          <h1 className="text-2xl font-bold text-foreground">Projects</h1>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
            {filtered.length}
            {filtered.length !== projects.length ? ` of ${projects.length}` : ""}{" "}
            projects
          </span>
        </div>

        <div
          role="group"
          aria-label="Toggle view mode"
          className="flex rounded-md border border-border overflow-hidden text-sm"
        >
          <button
            onClick={() => setView("list")}
            aria-pressed={view === "list"}
            className={`px-3 py-1.5 font-medium transition-colors inline-flex items-center gap-1.5 ${
              view === "list"
                ? "bg-gray-900 text-white"
                : "bg-card text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <List className="w-4 h-4" />
            List
          </button>
          <button
            onClick={() => setView("card")}
            aria-pressed={view === "card"}
            className={`px-3 py-1.5 font-medium transition-colors inline-flex items-center gap-1.5 ${
              view === "card"
                ? "bg-gray-900 text-white"
                : "bg-card text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
            Cards
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-56 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/70 pointer-events-none" />
          <label htmlFor="project-search" className="sr-only">
            Search projects by name or partner
          </label>
          <input
            id="project-search"
            type="text"
            placeholder="Search projects or partners…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div
          role="group"
          aria-label="Filter by status"
          className="flex rounded-md border border-border overflow-hidden text-sm"
        >
          {(["all", "Active", "Paused", "Archived"] as StatusFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              aria-pressed={statusFilter === f}
              className={`px-3 py-1.5 font-medium transition-colors ${
                statusFilter === f
                  ? "bg-gray-900 text-white"
                  : "bg-card text-muted-foreground hover:bg-muted/50"
              }`}
            >
              {f === "all" ? "All" : f}
            </button>
          ))}
        </div>

        <label htmlFor="partner-filter" className="sr-only">
          Filter by partner
        </label>
        <select
          id="partner-filter"
          value={partnerFilter}
          onChange={(e) => setPartnerFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">All partners</option>
          {allPartners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-lg py-16 text-center text-muted-foreground/70">
          No projects match your filters.
        </div>
      ) : view === "list" ? (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Name
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Status
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Partners
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Calendar email
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3 font-medium text-foreground">
                    {p.name}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {p.partners.length === 0 ? (
                      <span className="text-muted-foreground/60">Internal</span>
                    ) : (
                      p.partners
                        .map((pp) => pp.partnerOrg.name)
                        .join(", ")
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                    {p.calendarEmail ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <div
              key={p.id}
              className="bg-card border border-border rounded-lg p-4 hover:border-foreground/20 transition-colors"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <h2 className="font-semibold text-foreground leading-snug">
                  {p.name}
                </h2>
                <StatusBadge status={p.status} />
              </div>
              <div className="text-xs text-muted-foreground mb-3">
                {p.partners.length === 0 ? (
                  <span className="text-muted-foreground/60">Internal project</span>
                ) : (
                  <>
                    <span className="font-medium text-foreground/70">
                      Partners:
                    </span>{" "}
                    {p.partners.map((pp) => pp.partnerOrg.name).join(", ")}
                  </>
                )}
              </div>
              {p.calendarEmail && (
                <div className="text-xs text-muted-foreground/70 font-mono truncate">
                  {p.calendarEmail}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
        STATUS_STYLES[status] ?? "bg-muted text-muted-foreground"
      }`}
    >
      {status}
    </span>
  );
}
