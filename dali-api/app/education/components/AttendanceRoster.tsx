import { useState } from "react";
import { useRevalidator } from "react-router";
import { Button } from "~/components/ui/Button";

interface Row {
  applicationId: string;
  applicant: { id: string; firstName: string | null; lastName: string | null; netId: string | null };
  status: "Present" | "Absent" | "Excused" | null;
}

type Status = "Present" | "Absent" | "Excused";

export function AttendanceRoster({
  sessionId,
  initial,
}: {
  sessionId: string;
  initial: Row[];
}) {
  const { revalidate } = useRevalidator();
  const [rows, setRows] = useState<Record<string, Status | null>>(() =>
    Object.fromEntries(initial.map((r) => [r.applicationId, r.status])),
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  function setOne(applicationId: string, status: Status) {
    setRows((prev) => ({ ...prev, [applicationId]: status }));
  }

  async function save() {
    setSaving(true);
    setSavedAt(null);
    const payload = Object.entries(rows)
      .filter(([, status]) => status !== null)
      .map(([applicationId, status]) => ({ applicationId, status }));
    const res = await fetch(`/api/education/sessions/${sessionId}/attendance`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: payload }),
    });
    setSaving(false);
    if (res.ok) {
      setSavedAt(new Date().toLocaleTimeString());
      revalidate();
    }
  }

  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
            <th className="py-2 pr-3">Student</th>
            <th className="py-2 pr-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {initial.map((r) => {
            const name = `${r.applicant.firstName ?? ""} ${r.applicant.lastName ?? ""}`.trim() || r.applicant.netId || "Student";
            const current = rows[r.applicationId];
            return (
              <tr key={r.applicationId} className="border-b border-border/60">
                <td className="py-3 pr-3 text-dark-blue">{name}</td>
                <td className="py-3 pr-3">
                  <div className="flex gap-2">
                    {(["Present", "Absent", "Excused"] as Status[]).map((s) => (
                      <button
                        key={s}
                        onClick={() => setOne(r.applicationId, s)}
                        className={`text-xs px-3 py-1 rounded-full border transition ${
                          current === s
                            ? s === "Present"
                              ? "bg-green-100 text-green-700 border-green-300"
                              : s === "Absent"
                                ? "bg-red-100 text-red-700 border-red-300"
                                : "bg-yellow-100 text-yellow-800 border-yellow-300"
                            : "border-border text-muted-foreground hover:border-accent-coral"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={saving} onClick={save}>
          {saving ? "Saving..." : "Save attendance"}
        </Button>
        {savedAt && <span className="text-xs text-muted-foreground">Saved {savedAt}</span>}
      </div>
    </div>
  );
}
