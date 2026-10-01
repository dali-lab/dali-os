import { Link } from "react-router";
import { ArrowUpRight, X } from "lucide-react";
import { Modal } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";

export type TermMatrixRow = {
  projectId: string;
  projectName: string;
  iconEmoji: string | null;
  partnerNames: string[];
  roles: { domainName: string; slots: number }[];
};

// Read-only cross-tab for a term: one row per project with planned roles for
// that term, broken down by domain. The hub shows the picture; per-role
// staffing edits live under /projects/staffing, which already owns the
// cycle-aware role-request CRUD.
export function TermMatrix({
  termCode,
  rows,
  onClose,
}: {
  termCode: string;
  rows: TermMatrixRow[];
  onClose: () => void;
}) {
  // Union of domain names across the rows, in first-seen order, becomes the
  // column header set — a project not using a domain renders a dash in that
  // column rather than a dense per-row list.
  const domains: string[] = [];
  for (const r of rows) {
    for (const role of r.roles) {
      if (!domains.includes(role.domainName)) domains.push(role.domainName);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="term-matrix-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      containerClassName={modalCardClass("lg")}
    >
      <div className="flex flex-col h-full">
        <header className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 id="term-matrix-title" className="os-modal-title">
              Term {termCode}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {rows.length} {rows.length === 1 ? "project" : "projects"} planned.
              Open staffing for per-role edits.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to={`/projects/staffing?term=${encodeURIComponent(termCode)}`}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-os-well px-3 py-1 text-xs text-foreground hover:border-os-container-hi"
            >
              Open staffing <ArrowUpRight className="h-3 w-3" aria-hidden />
            </Link>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-os-item p-1.5 hover:bg-os-hover text-muted-foreground"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-auto px-5 py-4">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">
              No projects planned for this term yet.
            </p>
          ) : (
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead className="sticky top-0 bg-os-card z-10">
                <tr>
                  <th className="text-left font-medium text-muted-foreground px-3 py-2 border-b border-border w-[240px]">
                    Project
                  </th>
                  <th className="text-left font-medium text-muted-foreground px-3 py-2 border-b border-border">
                    Partners
                  </th>
                  {domains.map((d) => (
                    <th
                      key={d}
                      className="text-center font-medium text-muted-foreground px-2 py-2 border-b border-border w-[80px]"
                    >
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.projectId} className="hover:bg-os-hover">
                    <td className="px-3 py-2 border-b border-border">
                      <Link
                        to={`/projects/${r.projectId}`}
                        className="inline-flex items-center gap-2 text-foreground hover:text-os-accent"
                      >
                        {r.iconEmoji && <span>{r.iconEmoji}</span>}
                        <span className="font-medium truncate">{r.projectName}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-2 border-b border-border text-xs text-muted-foreground truncate">
                      {r.partnerNames.length ? r.partnerNames.join(", ") : "—"}
                    </td>
                    {domains.map((d) => {
                      const slots = r.roles.find((role) => role.domainName === d)?.slots ?? 0;
                      return (
                        <td
                          key={d}
                          className="px-2 py-2 border-b border-border text-center tabular-nums text-foreground"
                        >
                          {slots > 0 ? slots : <span className="text-muted-foreground">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Modal>
  );
}
