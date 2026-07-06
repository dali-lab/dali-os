import type React from "react";
import { DECISION_COLORS, STAGE_LABELS, STATUS_PILL_BASE } from "~/hiring/lib/labels";

export interface DecisionHistoryRow {
  id: string;
  type: string; // DecisionType key into labels.DECISION_COLORS
  stage: string; // key into labels.STAGE_LABELS
  waitlistRank?: number | null;
  notes?: string | null;
  createdAt: string | Date;
  madeByName?: string | null;
}

// Shared decision-history rows for the hiring detail routes. Pill colors come
// from the canonical labels.DECISION_COLORS so the same decision renders the
// same color everywhere.
//
// `showNotes` switches between the two existing layouts:
//   - true  → full route: roomy rows with notes + the maker's name + year.
//   - false → sidebar: compact rows, pill + stage + short date only.
export function DecisionHistoryList({
  decisions,
  showNotes = false,
}: {
  decisions: DecisionHistoryRow[];
  showNotes?: boolean;
}): React.ReactElement {
  const pillClass = (type: string) =>
    `${STATUS_PILL_BASE} ${DECISION_COLORS[type] ?? "bg-muted text-foreground/80"}`;

  if (!showNotes) {
    return (
      <div className="px-4 py-3 space-y-2">
        {decisions.map((d) => (
          <div key={d.id} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className={`${pillClass(d.type)} border border-current/30`}>
                {d.type}
                {d.waitlistRank != null && ` #${d.waitlistRank}`}
              </span>
              <span className="text-xs text-muted-foreground">
                {STAGE_LABELS[d.stage] ?? d.stage}
              </span>
            </div>
            <span className="text-xs text-muted-foreground/70">
              {new Date(d.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <ol className="divide-y divide-border">
      {decisions.map((d) => (
        <li key={d.id} className="px-6 py-3 flex items-start gap-3">
          <span className={`${pillClass(d.type)} flex-shrink-0`}>
            {d.type}
            {d.waitlistRank != null && ` #${d.waitlistRank}`}
          </span>
          <span className="text-xs text-muted-foreground flex-shrink-0 mt-0.5">
            {STAGE_LABELS[d.stage] ?? d.stage}
          </span>
          <div className="flex-1 min-w-0">
            {d.notes && (
              <p className="text-sm text-foreground whitespace-pre-wrap">{d.notes}</p>
            )}
          </div>
          <div className="text-xs text-muted-foreground/80 text-right flex-shrink-0">
            <div>
              {new Date(d.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </div>
            {d.madeByName && (
              <div className="text-[11px] text-muted-foreground/70">by {d.madeByName}</div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
