import { useState, useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";

interface CycleReviewer {
  id: string;
  daliMember: { id: string; user?: { id: string; firstName: string; lastName: string } | null };
  domain: { id: string; name: string };
}

export function ReviewerRosterTab({ cycleId }: { cycleId: string }) {
  const [reviewers, setReviewers] = useState<CycleReviewer[]>([]);
  const [newMemberId, setNewMemberId] = useState('');
  const [newDomainId, setNewDomainId] = useState('');
  const [allMembers, setAllMembers] = useState<{ id: string; daliEmail: string; firstName?: string | null; lastName?: string | null }[]>([]);
  const [allDomains, setAllDomains] = useState<{ id: string; name: string }[]>([]);

  const [interviewers, setInterviewers] = useState<any[]>([]);
  const [newInterviewerMemberId, setNewInterviewerMemberId] = useState('');
  const [newInterviewerDomainId, setNewInterviewerDomainId] = useState('');

  useEffect(() => {
    fetch(`/api/cycles/${cycleId}/reviewers`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setReviewers)
      .catch(() => {});

    fetch('/api/members', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setAllMembers)
      .catch(() => {});

    fetch('/api/domains', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setAllDomains)
      .catch(() => {});

    fetch(`/api/cycles/${cycleId}/interviewers`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setInterviewers)
      .catch(() => {});
  }, [cycleId]);

  async function addReviewer() {
    if (!newMemberId || !newDomainId) return;
    const res = await fetch(`/api/cycles/${cycleId}/reviewers`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daliMemberId: newMemberId, domainId: newDomainId }),
    });
    if (res.ok) {
      const reviewer = await res.json();
      setReviewers(prev => [...prev, reviewer]);
      setNewMemberId('');
      setNewDomainId('');
    }
  }

  async function removeReviewer(reviewerId: string) {
    const res = await fetch(`/api/cycles/${cycleId}/reviewers/${reviewerId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.ok) {
      setReviewers(prev => prev.filter(r => r.id !== reviewerId));
    }
  }

  async function addInterviewer() {
    if (!newInterviewerMemberId || !newInterviewerDomainId) return;
    const res = await fetch(`/api/cycles/${cycleId}/interviewers`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daliMemberId: newInterviewerMemberId, domainId: newInterviewerDomainId }),
    });
    if (res.ok) {
      const interviewer = await res.json();
      const member = allMembers.find(m => m.id === newInterviewerMemberId);
      const domain = allDomains.find(d => d.id === newInterviewerDomainId);
      setInterviewers(prev => [...prev, { ...interviewer, daliMember: member, domain }]);
      setNewInterviewerMemberId('');
      setNewInterviewerDomainId('');
    }
  }

  async function removeInterviewer(interviewerId: string) {
    const res = await fetch(`/api/cycles/${cycleId}/interviewers`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interviewerId }),
    });
    if (res.ok) {
      setInterviewers(prev => prev.filter(i => i.id !== interviewerId));
    }
  }

  return (
    <div className="space-y-4">
      {/* Add reviewer form */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-6">
        <h3 className="text-sm font-bold text-foreground/80 mb-4 flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add Reviewer
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">DALI Member</label>
            <select
              value={newMemberId}
              onChange={e => setNewMemberId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Select member...</option>
              {allMembers.map(m => (
                <option key={m.id} value={m.id}>
                  {m.firstName && m.lastName ? `${m.firstName} ${m.lastName}` : m.daliEmail}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Domain</label>
            <select
              value={newDomainId}
              onChange={e => setNewDomainId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Select domain...</option>
              {allDomains.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <button
            onClick={addReviewer}
            disabled={!newMemberId || !newDomainId}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      {/* Roster table */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 font-bold text-foreground/80">Reviewer</th>
              <th className="text-left px-4 py-3 font-bold text-foreground/80">Domain</th>
              <th className="text-right px-4 py-3 font-bold text-foreground/80">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {reviewers.map(r => (
              <tr key={r.id} className="hover:bg-muted/50 transition">
                <td className="px-4 py-3 font-medium text-foreground">
                  {r.daliMember.user ? `${r.daliMember.user.firstName} ${r.daliMember.user.lastName}` : r.daliMember.id}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{r.domain.name}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => removeReviewer(r.id)} className="text-red-500 hover:text-red-700 transition">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
            {reviewers.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground/70">No reviewers assigned yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add interviewer form */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-6">
        <h3 className="text-sm font-bold text-foreground/80 mb-4 flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add Interviewer
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">DALI Member</label>
            <select
              value={newInterviewerMemberId}
              onChange={e => setNewInterviewerMemberId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Select member...</option>
              {allMembers.map(m => (
                <option key={m.id} value={m.id}>
                  {m.firstName && m.lastName ? `${m.firstName} ${m.lastName}` : m.daliEmail}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Domain</label>
            <select
              value={newInterviewerDomainId}
              onChange={e => setNewInterviewerDomainId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Select domain...</option>
              {allDomains.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <button
            onClick={addInterviewer}
            disabled={!newInterviewerMemberId || !newInterviewerDomainId}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      {/* Interviewer roster table */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 font-bold text-foreground/80">Interviewer</th>
              <th className="text-left px-4 py-3 font-bold text-foreground/80">Domain</th>
              <th className="text-right px-4 py-3 font-bold text-foreground/80">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {interviewers.map((i: any) => {
              const m = i.daliMember;
              const name = m?.firstName && m?.lastName ? `${m.firstName} ${m.lastName}` : m?.daliEmail ?? i.daliMemberId;
              return (
                <tr key={i.id} className="hover:bg-muted/50 transition">
                  <td className="px-4 py-3 font-medium text-foreground">{name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{i.domain?.name ?? ''}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => removeInterviewer(i.id)} className="text-red-500 hover:text-red-700 transition">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {interviewers.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground/70">No interviewers assigned yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
