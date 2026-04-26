import { useState, useEffect } from "react";

interface InterviewRow {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  domainApplication: {
    challengeVersion: { domain: { name: string } };
    application: { user: { firstName: string; lastName: string } };
  };
  assignments: {
    id: string;
    role: string;
    status: string;
    cycleInterviewer: {
      daliMember: { firstName: string | null; lastName: string | null; daliEmail: string | null };
      domain: { name: string };
    };
  }[];
}

export function InterviewDashboardTab({ cycleId }: { cycleId: string }) {
  const [interviews, setInterviews] = useState<InterviewRow[]>([]);
  const [interviewers, setInterviewers] = useState<any[]>([]);

  useEffect(() => {
    fetch(`/api/cycles/${cycleId}/interviews`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setInterviews)
      .catch(() => {});

    fetch(`/api/cycles/${cycleId}/interviewers`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setInterviewers)
      .catch(() => {});
  }, [cycleId]);

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 font-bold text-foreground/80">Applicant</th>
              <th className="text-left px-4 py-3 font-bold text-foreground/80">Domain</th>
              <th className="text-left px-4 py-3 font-bold text-foreground/80">Time</th>
              <th className="text-left px-4 py-3 font-bold text-foreground/80">Status</th>
              <th className="text-left px-4 py-3 font-bold text-foreground/80">Interviewers</th>
              <th className="text-right px-4 py-3 font-bold text-foreground/80">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {interviews.map(interview => {
              const isFuture = new Date(interview.startTime) > new Date();
              const domainName = interview.domainApplication.challengeVersion.domain.name;
              const start = new Date(interview.startTime);
              const end = new Date(interview.endTime);

              return (
                <tr key={interview.id} className="hover:bg-muted/50 transition">
                  <td className="px-4 py-3 font-medium text-foreground">
                    {interview.domainApplication.application.user.firstName} {interview.domainApplication.application.user.lastName}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{domainName || '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{' '}
                    {start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} –{' '}
                    {end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                      interview.status === 'Scheduled' ? 'bg-green-100 text-green-700' :
                      interview.status === 'Completed' ? 'bg-blue-100 text-blue-700' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {interview.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {interview.assignments
                      .filter((a: any) => a.status === 'Active')
                      .map((a: any) => {
                        const m = a.cycleInterviewer.daliMember;
                        const name = m.firstName && m.lastName
                          ? `${m.firstName} ${m.lastName}`
                          : m.daliEmail ?? '?';
                        const roleLabel = a.role === 'InDomain' ? a.cycleInterviewer.domain.name : 'Cross';
                        return (
                          <div key={a.id} className="flex items-center gap-1">
                            <span>{name} ({roleLabel})</span>
                            {isFuture && interview.status === 'Scheduled' && (
                              <select
                                className="ml-1 text-[10px] border border-gray-300 rounded px-1 py-0.5"
                                defaultValue=""
                                onChange={async (e) => {
                                  if (!e.target.value) return;
                                  await fetch(`/api/interviews/${interview.id}/reassign`, {
                                    method: 'POST', credentials: 'include',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ assignmentId: a.id, newCycleInterviewerId: e.target.value }),
                                  });
                                  window.location.reload();
                                }}
                              >
                                <option value="">Reassign...</option>
                                {interviewers
                                  .filter((i: any) => a.role === 'InDomain'
                                    ? i.domain?.name === a.cycleInterviewer.domain.name
                                    : i.domain?.name !== domainName)
                                  .filter((i: any) => i.id !== a.cycleInterviewerId)
                                  .map((i: any) => {
                                    const im = i.daliMember;
                                    const iName = im?.firstName && im?.lastName ? `${im.firstName} ${im.lastName}` : im?.daliEmail ?? i.id;
                                    return <option key={i.id} value={i.id}>{iName}</option>;
                                  })}
                              </select>
                            )}
                          </div>
                        );
                      })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {/* placeholder for future actions */}
                  </td>
                </tr>
              );
            })}
            {interviews.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground/70">No interviews scheduled yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
