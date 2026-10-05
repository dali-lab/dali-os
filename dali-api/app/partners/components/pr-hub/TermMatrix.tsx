import { Link } from "react-router";
import { ArrowUpRight } from "lucide-react";
import { SlideOver } from "./SlideOver";
import { ProjectIcon } from "~/components/ProjectIcon";

export type TermMatrixRow = {
  projectId: string;
  projectName: string;
  iconEmoji: string | null;
  partnerNames: string[];
  roles: { domainName: string; slots: number }[];
};

// Read-only cross-tab for a term: one row per project with planned roles for
// that term, broken down by domain. Rendered inside the hub's right-side
// SlideOver so the planning view is immediate and dismissible — per-role
// staffing edits still live under /projects/staffing.
export function TermMatrix({
  open,
  termCode,
  rows,
  onClose,
}: {
  open: boolean;
  termCode: string;
  rows: TermMatrixRow[];
  onClose: () => void;
}) {
  const domains: string[] = [];
  for (const r of rows) {
    for (const role of r.roles) {
      if (!domains.includes(role.domainName)) domains.push(role.domainName);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      overline="Term plan"
      accent="coral"
      title={`Term ${termCode}`}
      subtitle={`${rows.length} ${rows.length === 1 ? "project" : "projects"} planned. Open staffing for per-role edits.`}
      width={560}
      footer={
        <div className="flex items-center justify-end">
          <Link
            to={`/projects/staffing?term=${encodeURIComponent(termCode)}`}
            className="hub-sheet-primary inline-flex items-center justify-center gap-2 px-4 py-2 text-[13px] font-semibold"
          >
            Open staffing <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-10">
          No projects planned for this term yet.
        </p>
      ) : (
        <div className="hub-term-plan">
          {rows.map((r) => (
            <article key={r.projectId} className="hub-term-plan-row">
              <Link
                to={`/projects/${r.projectId}`}
                className="hub-term-plan-head"
              >
                <ProjectIcon iconEmoji={r.iconEmoji} size="lg" />
                <div className="min-w-0">
                  <h3 className="truncate">{r.projectName}</h3>
                  <p>
                    {r.partnerNames.length
                      ? r.partnerNames.join(" · ")
                      : "No partner yet"}
                  </p>
                </div>
                <ArrowUpRight aria-hidden />
              </Link>
              {r.roles.length > 0 && (
                <ul className="hub-term-plan-roles" aria-label="Planned roles">
                  {r.roles.map((role) => (
                    <li key={role.domainName}>
                      <span>{role.domainName}</span>
                      <strong>{role.slots}</strong>
                    </li>
                  ))}
                </ul>
              )}
              {domains.length > 0 && r.roles.length === 0 && (
                <p className="hub-term-plan-empty">No roles requested yet.</p>
              )}
            </article>
          ))}
        </div>
      )}
    </SlideOver>
  );
}
