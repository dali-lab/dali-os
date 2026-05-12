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

export function ApplicationList({ rows, selectedStatusLabel, selectedDomainName }: Props) {
  const heading = selectedStatusLabel
    ? `${selectedStatusLabel} · ${selectedDomainName ?? "All Domains"}`
    : `All Applications · ${selectedDomainName ?? "All Domains"}`;

  return (
    <div className="bg-card border border-border rounded-lg">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium text-foreground">{heading}</h3>
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
                <tr key={r.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-4 py-2 text-foreground">{r.applicantName}</td>
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
