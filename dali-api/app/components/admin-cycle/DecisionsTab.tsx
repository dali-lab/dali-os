import { useState } from "react";

export function DecisionsTab({ initialDecisions }: { initialDecisions: any[] }) {
  const [pendingDecisions, setPendingDecisions] = useState<any[]>(initialDecisions ?? []);
  const [releasing, setReleasing] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-muted/50 flex items-center justify-between">
          <h3 className="font-bold text-foreground">Final Decisions Ready for Release</h3>
          {pendingDecisions.length > 0 && (
            <button
              onClick={async () => {
                for (const d of pendingDecisions) {
                  await fetch(`/api/decisions/${d.id}/release`, { method: 'POST', credentials: 'include' });
                }
                setPendingDecisions([]);
              }}
              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white transition"
            >
              Release All ({pendingDecisions.length})
            </button>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 font-bold text-foreground/80">Applicant</th>
              <th className="text-left px-4 py-3 font-bold text-foreground/80">Domain</th>
              <th className="text-left px-4 py-3 font-bold text-foreground/80">Decision</th>
              <th className="text-left px-4 py-3 font-bold text-foreground/80">Made By</th>
              <th className="text-right px-4 py-3 font-bold text-foreground/80">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {pendingDecisions.map((d: any) => (
              <tr key={d.id} className="hover:bg-muted/50 transition">
                <td className="px-4 py-3 font-medium text-foreground">
                  {d.domainApplication.application.user.firstName} {d.domainApplication.application.user.lastName}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{d.domainApplication.challengeVersion.domain.name}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                    d.type === 'Accepted' ? 'bg-green-100 text-green-700' :
                    d.type === 'Rejected' ? 'bg-red-100 text-red-700' :
                    d.type === 'Waitlisted' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>
                    {d.type}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{d.madeBy.firstName} {d.madeBy.lastName}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={async () => {
                      setReleasing(d.id);
                      await fetch(`/api/decisions/${d.id}/release`, { method: 'POST', credentials: 'include' });
                      setPendingDecisions(prev => prev.filter(p => p.id !== d.id));
                      setReleasing(null);
                    }}
                    disabled={releasing === d.id}
                    className="px-3 py-1 text-sm font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white transition disabled:opacity-50"
                  >
                    {releasing === d.id ? 'Releasing...' : 'Release'}
                  </button>
                </td>
              </tr>
            ))}
            {pendingDecisions.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground/70">No Final decisions awaiting release.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
