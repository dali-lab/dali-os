import { Link, useNavigate, useRevalidator } from "react-router";
import { useState } from "react";
import { FolderKanban, Plus, Archive, ChevronRight } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { ProjectCreateModal } from "./ProjectCreateModal";
import type { DirectoryProject } from "~/projects/lib/queries";

interface Props {
  directory: {
    mine: DirectoryProject[];
    active: DirectoryProject[];
    pastOrArchived: DirectoryProject[];
  };
  canCreate: boolean;
  showArchived: boolean;
  currentTermCode: string | null;
  currentTermId: string | null;
  partnerOrgs: { id: string; name: string }[];
  pmEligibleMembers: { id: string; firstName: string; lastName: string }[];
  terms: { id: string; code: string }[];
}

export function ProjectDirectory({
  directory,
  canCreate,
  showArchived,
  currentTermCode,
  currentTermId,
  partnerOrgs,
  pmEligibleMembers,
  terms,
}: Props) {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [createOpen, setCreateOpen] = useState(false);

  const toggleArchived = () => {
    const url = new URL(window.location.href);
    if (showArchived) url.searchParams.delete("archived");
    else url.searchParams.set("archived", "1");
    navigate(url.pathname + url.search);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FolderKanban className="w-6 h-6 text-accent-coral" />
            Projects
          </h1>
          {currentTermCode && (
            <p className="text-sm text-muted-foreground mt-1">
              Current term: <span className="font-medium">{currentTermCode}</span>
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={toggleArchived}>
            <Archive className="w-3.5 h-3.5" />
            {showArchived ? "Hide past & archived" : "Show past & archived"}
          </Button>
          {canCreate && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="w-3.5 h-3.5" />
              New project
            </Button>
          )}
        </div>
      </div>

      <Section
        title="My projects"
        subtitle={
          currentTermCode
            ? `Where you have an assignment for ${currentTermCode}`
            : "Your current-term projects"
        }
        rows={directory.mine}
        empty="No current-term assignments yet."
      />

      <Section
        title="Other active projects"
        subtitle="Active projects across the lab"
        rows={directory.active}
        empty="No other active projects."
      />

      {showArchived && (
        <Section
          title="Past & archived"
          subtitle="Paused and archived projects, plus assignments from older terms"
          rows={directory.pastOrArchived}
          muted
          empty="No past or archived projects."
        />
      )}

      {createOpen && (
        <ProjectCreateModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          terms={terms}
          defaultTermId={currentTermId}
          partnerOrgs={partnerOrgs}
          pmEligibleMembers={pmEligibleMembers}
          onCreated={(projectId) => {
            setCreateOpen(false);
            if (projectId) {
              navigate(`/projects/${projectId}`);
            } else {
              revalidator.revalidate();
            }
          }}
        />
      )}
    </div>
  );
}

function Section({
  title,
  subtitle,
  rows,
  empty,
  muted,
}: {
  title: string;
  subtitle?: string;
  rows: DirectoryProject[];
  empty: string;
  muted?: boolean;
}) {
  return (
    <section>
      <header className="mb-3">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </header>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">{empty}</p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map((p) => (
            <li key={p.id}>
              <ProjectCard project={p} muted={muted} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProjectCard({
  project,
  muted,
}: {
  project: DirectoryProject;
  muted?: boolean;
}) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className={`group block rounded-xl border border-border bg-card p-4 hover:border-accent-coral hover:bg-accent-coral/5 transition ${
        muted ? "opacity-70" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground truncate">
              {project.name}
            </span>
            {project.status !== "Active" && (
              <span className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
                {project.status}
              </span>
            )}
          </div>
          {project.firstTermCode && (
            <div className="text-xs text-muted-foreground mt-0.5">
              Since {project.firstTermCode}
            </div>
          )}
          <div className="text-xs text-muted-foreground mt-2 space-y-0.5">
            {project.pms.length > 0 && (
              <div>
                <span className="font-medium">PM:</span>{" "}
                {project.pms.map((p) => `${p.firstName} ${p.lastName}`).join(", ")}
              </div>
            )}
            {project.partners.length > 0 && (
              <div>
                <span className="font-medium">Partner:</span>{" "}
                {project.partners.map((p) => p.name).join(", ")}
              </div>
            )}
            <div className="text-[11px] text-muted-foreground/70">
              {project.memberCount} member{project.memberCount === 1 ? "" : "s"}
            </div>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-accent-coral mt-0.5" />
      </div>
    </Link>
  );
}
