import { useState, useEffect } from "react";
import { CheckCircle, Plus, Trash2, Clock } from "lucide-react";

export function InterviewerSection({ cycleId, domainId, initialInterviewers }: {
  cycleId: string;
  domainId: string;
  initialInterviewers: any[];
}) {
  const [interviewers, setInterviewers] = useState(initialInterviewers);
  const [members, setMembers] = useState<any[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState("");

  useEffect(() => {
    fetch("/api/members", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(setMembers)
      .catch(() => {});
  }, []);

  async function addInterviewer() {
    if (!selectedMemberId) return;
    const res = await fetch(`/api/cycles/${cycleId}/interviewers`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ daliMemberId: selectedMemberId, domainId }),
    });
    if (res.ok) {
      const interviewer = await res.json();
      const member = members.find((m: any) => m.id === selectedMemberId);
      setInterviewers(prev => [...prev, { ...interviewer, daliMember: member, availabilityHours: 0 }]);
      setSelectedMemberId("");
    }
  }

  async function removeInterviewer(interviewerId: string) {
    const res = await fetch(`/api/cycles/${cycleId}/interviewers`, {
      method: "DELETE", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interviewerId }),
    });
    if (res.ok) setInterviewers(prev => prev.filter(i => i.id !== interviewerId));
  }

  const existingMemberIds = new Set(interviewers.map((i: any) => i.daliMemberId));
  const availableMembers = members.filter(m => !existingMemberIds.has(m.id));

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-border bg-muted/50">
        <h3 className="font-semibold text-foreground">Interviewers for this Domain ({interviewers.length})</h3>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="block text-xs font-medium text-muted-foreground mb-1">Add Interviewer</label>
            <select
              value={selectedMemberId}
              onChange={e => setSelectedMemberId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Select member...</option>
              {availableMembers.map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.firstName && m.lastName ? `${m.firstName} ${m.lastName}` : m.daliEmail ?? m.id}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={addInterviewer}
            disabled={!selectedMemberId}
            className="flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
        {interviewers.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {interviewers.map((i: any) => {
              const m = i.daliMember;
              const name = m?.firstName && m?.lastName
                ? `${m.firstName} ${m.lastName}`
                : m?.daliEmail ?? i.daliMemberId;
              const hours = i.availabilityHours ?? 0;
              const hasAvailability = hours > 0;
              const hoursLabel =
                Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
              return (
                <div key={i.id} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-foreground truncate">{name}</span>
                    {hasAvailability ? (
                      <span className="flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                        <CheckCircle className="w-3 h-3" />
                        {hoursLabel} available
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground bg-muted/50 border border-border px-2 py-0.5 rounded-full">
                        <Clock className="w-3 h-3" />
                        No availability
                      </span>
                    )}
                  </div>
                  <button onClick={() => removeInterviewer(i.id)} className="text-red-500 hover:text-red-700">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/70 text-center py-3">No interviewers assigned yet.</p>
        )}
      </div>
    </div>
  );
}
