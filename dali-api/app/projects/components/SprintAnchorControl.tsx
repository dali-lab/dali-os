import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { Popover, Select } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { WEEKDAY_LABELS } from "../lib/sprints";
import type { SprintAnchor } from "../lib/task-board";

const WEEKDAY_OPTIONS = WEEKDAY_LABELS.map((label, i) => ({ value: String(i), label }));

/**
 * "Sprints start Wednesday · change" — the weekday each current/upcoming term's
 * sprints begin on. Changing it rebuilds that term's upcoming sprints only.
 */
export function SprintAnchorControl({
  projectId,
  anchors,
  canEdit,
  focusTermId,
  onSaved,
}: {
  projectId: string;
  anchors: SprintAnchor[];
  canEdit: boolean;
  focusTermId: string | null;
  onSaved: () => void;
}) {
  const { os } = useOsChrome();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  if (anchors.length === 0) return null;
  const focus = anchors.find((a) => a.termId === focusTermId) ?? anchors[0]!;
  const summary = `Sprints start ${WEEKDAY_LABELS[focus.anchorDay]}`;
  const text = cn("text-muted-foreground", os ? "text-sm" : "text-xs");
  if (!canEdit) return <span className={text}>{summary}</span>;

  async function save(termId: string, anchorDay: number) {
    setSaving(termId);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/sprint-anchor`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ termId, anchorDay }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed: ${res.status}`);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Popover
      align="right"
      ariaLabel="Sprint start day"
      trigger={
        <button type="button" className={cn(text, "inline-flex items-center gap-1.5 hover:text-foreground")}>
          <CalendarClock className="h-3.5 w-3.5" aria-hidden />
          {summary}
          <span className={os ? "text-os-accent" : "text-accent-coral"}>· change</span>
        </button>
      }
    >
      <div className="flex w-72 flex-col gap-3 p-1">
        <p className="text-xs text-muted-foreground">
          The day your team's weekly sprint starts. Changing it reshapes upcoming sprints only;
          the current sprint stretches to meet the new start day.
        </p>
        {anchors.map((a) => (
          <label key={a.termId} className="flex items-center justify-between gap-3 text-sm">
            <span>{a.termCode}</span>
            <Select
              value={String(a.anchorDay)}
              options={WEEKDAY_OPTIONS}
              disabled={saving !== null}
              ariaLabel={`Sprint start day for ${a.termCode}`}
              onChange={(v) => void save(a.termId, Number(v))}
            />
          </label>
        ))}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </Popover>
  );
}
