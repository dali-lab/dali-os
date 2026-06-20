interface SessionRow {
  id: string;
  sequence: number;
  datetime: string;
  location: string | null;
  recordingUrl: string | null;
  materialsDocId: string | null;
}

export function SessionList({ sessions }: { sessions: SessionRow[] }) {
  if (sessions.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No sessions scheduled yet.</p>;
  }
  return (
    <ol className="space-y-3">
      {sessions.map((s) => (
        <li key={s.id} className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-baseline justify-between mb-1">
            <h3 className="font-heading text-sm font-bold text-dark-blue">
              Session {s.sequence}
            </h3>
            <span className="text-xs text-muted-foreground">{new Date(s.datetime).toLocaleString()}</span>
          </div>
          {s.location && (
            <p className="text-xs text-muted-foreground">📍 {s.location}</p>
          )}
          <div className="mt-2 flex gap-3 text-xs">
            {s.materialsDocId && (
              <a href={`/documents/${s.materialsDocId}`} className="text-accent-coral hover:underline">
                Materials →
              </a>
            )}
            {s.recordingUrl && (
              <a href={s.recordingUrl} target="_blank" rel="noopener noreferrer" className="text-accent-coral hover:underline">
                Recording →
              </a>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
