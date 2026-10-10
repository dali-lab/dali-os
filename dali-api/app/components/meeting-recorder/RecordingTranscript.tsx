import { useMemo, useState } from "react";
import { Select, type SelectOption } from "~/components/ui/floating";
import { SearchInput } from "~/components/ui/SearchInput";
import { buttonClasses } from "~/components/ui/Button";
import { cn } from "~/lib/cn";
import { formatClock, speakerLabelFor } from "./transcript";
import type { UseMeetingRecording } from "./use-meeting-recording";

const SOMEONE_ELSE = "__other__";

/**
 * The rail's transcript region (specs/meeting-recording-rail.md "Rail
 * layout"): speaker chips pinned at the top, a search filter, and the
 * `[mm:ss] Label: text` lines, full height below whatever state body
 * preceded it. Each chip is a Select over the roster plus "Someone else…",
 * which reveals an inline text field under the chip with Save — replacing
 * the old dialog.choice + dialog.prompt pair.
 */
export function RecordingTranscript({ rec }: { rec: UseMeetingRecording }) {
  const [query, setQuery] = useState("");

  const highlightedLine = rec.highlightLineIndex >= 0 ? rec.sortedLines[rec.highlightLineIndex] : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rec.sortedLines;
    return rec.sortedLines.filter(
      (l) =>
        l.text.toLowerCase().includes(q) ||
        speakerLabelFor(l, rec.speakerCounts, rec.speakers, rec.roster).toLowerCase().includes(q),
    );
  }, [query, rec.sortedLines, rec.speakerCounts, rec.speakers, rec.roster]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {rec.speakerKeys.length > 0 && (
        <div className="flex flex-wrap items-start gap-1.5">
          {rec.speakerKeys.map((key) => (
            <SpeakerChip key={key} speakerKey={key} rec={rec} />
          ))}
        </div>
      )}
      <SearchInput
        size="sm"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search transcript"
        aria-label="Search transcript"
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-xl bg-os-well px-3 py-2 text-sm leading-relaxed">
        {filtered.length === 0 ? (
          <p className="text-muted-foreground">No lines match.</p>
        ) : (
          filtered.map((l, i) => (
            <p
              key={i}
              ref={l === highlightedLine ? rec.highlightLineRef : undefined}
              className={cn(
                "scroll-mt-2 rounded px-1 -mx-1",
                l === highlightedLine ? "bg-os-accent/15 text-foreground" : "text-foreground",
              )}
            >
              <span className="mr-2 font-mono text-[11px] text-muted-foreground">{formatClock(l.at)}</span>
              <span className="mr-1 font-medium text-muted-foreground">
                {speakerLabelFor(l, rec.speakerCounts, rec.speakers, rec.roster)}:
              </span>
              {l.text}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

function SpeakerChip({ speakerKey, rec }: { speakerKey: string; rec: UseMeetingRecording }) {
  const line = rec.lines.find((l) => l.speaker === speakerKey);
  const label = line ? speakerLabelFor(line, rec.speakerCounts, rec.speakers, rec.roster) : speakerKey;
  const [editingOther, setEditingOther] = useState(false);
  const [otherText, setOtherText] = useState("");

  if (!rec.canEdit) {
    return <span className="rounded-full bg-os-container px-2 py-0.5 text-xs">{label}</span>;
  }

  const assigned = rec.speakers[speakerKey];
  const value = assigned && rec.roster.some((r) => r.userId === assigned) ? assigned : undefined;
  const options: SelectOption[] = [
    ...rec.roster.map((r) => ({ value: r.userId, label: r.name })),
    { value: SOMEONE_ELSE, label: "Someone else…" },
  ];

  return (
    <div className="flex flex-col gap-1">
      <Select
        value={value}
        onChange={(next) => {
          if (next === SOMEONE_ELSE) {
            setEditingOther(true);
            return;
          }
          setEditingOther(false);
          void rec.setSpeaker(speakerKey, next);
        }}
        options={options}
        placeholder={label}
        ariaLabel={`Rename ${label}`}
      />
      {editingOther && (
        <div className="flex items-center gap-1">
          <input
            type="text"
            autoFocus
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            placeholder="e.g. a guest"
            className="w-28 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-coral/30"
          />
          <button
            type="button"
            onClick={() => {
              if (!otherText.trim()) return;
              void rec.setSpeaker(speakerKey, otherText.trim());
              setEditingOther(false);
              setOtherText("");
            }}
            className={buttonClasses("secondary", "sm")}
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
