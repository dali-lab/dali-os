import { useNavigate } from "react-router";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";

export interface ApplicationRow {
  id: string;
  applicantName: string;
  status: string;
  statusLabel: string;
  domain: string;
  reviewers: string[];
  interviewers: string[];
}

interface Props {
  rows: ApplicationRow[];
  selectedStatusLabel: string | null;
  selectedDomainName: string | null;
}

export function ApplicationList({ rows, selectedStatusLabel }: Props) {
  const navigate = useNavigate();

  return (
    <div className="bg-card border border-border rounded-lg">
      <div className="flex items-center justify-end px-4 py-3 border-b border-border">
        <span className="text-xs text-muted-foreground">
          {rows.length} {rows.length === 1 ? "application" : "applications"}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          {selectedStatusLabel
            ? "No applications in this category."
            : "Select a slice of the pie chart to filter, or no applications match the current filter."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left font-medium px-4 py-2">Name</th>
                <th className="text-left font-medium px-4 py-2">Status</th>
                <th className="text-left font-medium px-4 py-2">Domain</th>
                <th className="text-left font-medium px-4 py-2">Reviewers</th>
                <th className="text-left font-medium px-4 py-2">Interviewers</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => {
                    const url = `/hiring/applications/${r.id}`;
                    if (!requestOpenTabIfEmbedded(url, r.applicantName)) {
                      navigate(url);
                    }
                  }}
                  className="border-t border-border hover:bg-muted/20 cursor-pointer"
                >
                  <td className="px-4 py-2 text-accent-coral">{r.applicantName}</td>
                  <td className="px-4 py-2 text-foreground">{r.statusLabel}</td>
                  <td className="px-4 py-2 text-foreground">{r.domain}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {r.reviewers.length > 0 ? r.reviewers.join(", ") : "—"}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {r.interviewers.length > 0 ? r.interviewers.join(", ") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
