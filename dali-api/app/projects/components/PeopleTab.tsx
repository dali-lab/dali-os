import { useNavigate } from "react-router";
import type { RosterEntry, WorkspaceData } from "~/projects/lib/queries";

interface Data {
  roster: RosterEntry[];
  history: { termId: string; termCode: string }[];
  selectedTermCode: string | null;
  selectedTermId: string | null;
  partners: {
    id: string;
    partnerOrg: {
      id: string;
      name: string;
      users: {
        displayRole: string | null;
        user: {
          id: string;
          firstName: string;
          lastName: string;
          dartmouthEmail: string | null;
          daliEmail: string | null;
        };
      }[];
    };
  }[];
}

interface Props {
  data: Data;
  workspace: WorkspaceData;
}

export function PeopleTab({ data, workspace }: Props) {
  const navigate = useNavigate();
  const onTermChange = (termId: string) => {
    const params = new URLSearchParams(window.location.search);
    if (termId) params.set("term", termId);
    else params.delete("term");
    navigate(`/projects/${workspace.project.id}/people?${params.toString()}`);
  };

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-lg font-semibold text-foreground">Roster</h2>
          {data.history.length > 0 && (
            <select
              value={data.selectedTermId ?? ""}
              onChange={(e) => onTermChange(e.target.value)}
              className="text-xs rounded-lg border border-border bg-card px-2 py-1"
            >
              {data.history.map((h) => (
                <option key={h.termId} value={h.termId}>
                  {h.termCode}
                </option>
              ))}
            </select>
          )}
        </div>
        {data.roster.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No assignments for this term.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Member</th>
                  <th className="text-left px-3 py-2 font-medium">Domain · Level</th>
                  <th className="text-left px-3 py-2 font-medium">Mentor(s)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.roster.map((r) => (
                  <tr key={r.user.id}>
                    <td className="px-3 py-2 font-medium">
                      {r.user.firstName} {r.user.lastName}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.domains.map((d) => `${d.displayName} ${d.level}`).join(", ")}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.mentors.length === 0
                        ? "—"
                        : r.mentors
                            .map(
                              (m) =>
                                `${m.firstName} ${m.lastName} (${m.domainCode})`,
                            )
                            .join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">Partners</h2>
        {data.partners.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No partners linked.
          </p>
        ) : (
          <div className="space-y-3">
            {data.partners.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-border bg-card p-3"
              >
                <div className="font-medium text-foreground">
                  {p.partnerOrg.name}
                </div>
                <ul className="mt-2 text-xs text-muted-foreground space-y-1">
                  {p.partnerOrg.users.length === 0 ? (
                    <li className="italic">No contacts yet.</li>
                  ) : (
                    p.partnerOrg.users.map((u) => (
                      <li key={u.user.id}>
                        {u.user.firstName} {u.user.lastName}
                        {u.displayRole ? ` · ${u.displayRole}` : ""}
                        {u.user.dartmouthEmail ? ` · ${u.user.dartmouthEmail}` : ""}
                      </li>
                    ))
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
