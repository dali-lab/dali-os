import { Link, NavLink } from "react-router";
import type { ReactNode } from "react";
import { ArrowLeft, Users, Calendar, ListChecks, Inbox, Settings } from "lucide-react";
import type { WorkspaceData } from "~/projects/lib/queries";
import type { ProjectMembership } from "~/lib/projectAuth";

interface Props {
  workspace: WorkspaceData;
  membership: ProjectMembership;
  children: ReactNode;
}

export function ProjectWorkspaceLayout({ workspace, membership, children }: Props) {
  const { project, pms, memberCount } = workspace;
  const showSettings = membership.canEditSettings || membership.canArchive;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header>
        <Link
          to="/projects"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-3 h-3" />
          All projects
        </Link>

        <div className="mt-3 flex items-start gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-foreground">
              {project.name}
              {project.status !== "Active" && (
                <span className="ml-2 text-[10px] uppercase font-semibold tracking-wider text-muted-foreground px-1.5 py-0.5 rounded bg-muted align-middle">
                  {project.status}
                </span>
              )}
            </h1>
            <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {project.firstTerm && (
                <span>Since {project.firstTerm.code}</span>
              )}
              {pms.length > 0 && (
                <span>
                  <span className="font-medium">PM:</span>{" "}
                  {pms.map((p) => `${p.firstName} ${p.lastName}`).join(", ")}
                </span>
              )}
              {project.partners.length > 0 && (
                <span>
                  <span className="font-medium">Partners:</span>{" "}
                  {project.partners.map((p) => p.partnerOrg.name).join(", ")}
                </span>
              )}
              <span>{memberCount} member{memberCount === 1 ? "" : "s"}</span>
            </div>
          </div>
        </div>

        {project.status === "Archived" && (
          <div className="mt-3 text-xs px-3 py-2 rounded-lg bg-muted text-muted-foreground border border-border">
            This project is archived. It's read-only for everyone outside Core.
          </div>
        )}
      </header>

      <nav className="flex flex-wrap items-center gap-1 border-b border-border">
        <Tab to={`/projects/${project.id}`} end label="Overview" />
        <Tab to={`/projects/${project.id}/people`} icon={Users} label="People" />
        <Tab to={`/projects/${project.id}/sprints`} icon={Calendar} label="Sprints" />
        <Tab to={`/projects/${project.id}/tasks`} icon={ListChecks} label="Tasks" />
        <Tab to={`/projects/${project.id}/backlog`} icon={Inbox} label="Backlog" />
        {showSettings && (
          <Tab to={`/projects/${project.id}/settings`} icon={Settings} label="Settings" />
        )}
      </nav>

      <main>{children}</main>
    </div>
  );
}

function Tab({
  to,
  label,
  icon: Icon,
  end,
}: {
  to: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition ${
          isActive
            ? "border-accent-coral text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground"
        }`
      }
    >
      {Icon && <Icon className="w-3.5 h-3.5" />}
      {label}
    </NavLink>
  );
}
