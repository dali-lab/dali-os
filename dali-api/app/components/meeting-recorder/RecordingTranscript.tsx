import { useEffect, useMemo, useRef, useState } from "react";
import { Combobox, type SelectOption } from "~/components/ui/floating";
import { useSelectTriggerClass } from "~/components/ui/floating/os-styles";
import { SearchInput } from "~/components/ui/SearchInput";
import { buttonClasses } from "~/components/ui/Button";
import { cn } from "~/lib/cn";
import { formatClock, speakerLabelFor } from "./transcript";
import type { UseMeetingRecording } from "./use-meeting-recording";

const SOMEONE_ELSE = "__other__";
const SEARCH_MIN_CHARS = 2;
const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_LIMIT = 8;

type SearchMember = { id: string; name: string; handle: string };

async function searchLabMembers(query: string): Promise<SearchMember[]> {
  try {
    const res = await fetch(`/api/mentions/search?q=${encodeURIComponent(query)}`, { credentials: "include" });
    if (!res.ok) return [];
    const data = (await res.json()) as { members?: SearchMember[] };
    return (data.members ?? []).slice(0, SEARCH_LIMIT);
  } catch {
    return [];
  }
}

/**
 * The rail's transcript region (specs/meeting-recording-rail.md "Rail
 * layout"): speaker chips pinned at the top, a search filter, and the
 * `[mm:ss] Label: text` lines, full height below whatever state body
 * preceded it. Each chip is a Combobox over the occurrence roster, then
 * (typing 2+ chars) any lab member found via the mentions-search endpoint,
 * then "Someone else…", which reveals an inline text field under the chip
 * with Save — replacing the old dialog.choice + dialog.prompt pair and the
 * roster-only Select that left a chip a dead end once the roster was empty.
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
        speakerLabelFor(l, rec.speakerCounts, rec.speakers, rec.roster, rec.speakerNames).toLowerCase().includes(q),
    );
  }, [query, rec.sortedLines, rec.speakerCounts, rec.speakers, rec.roster, rec.speakerNames]);

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
                {speakerLabelFor(l, rec.speakerCounts, rec.speakers, rec.roster, rec.speakerNames)}:
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
  const triggerClass = useSelectTriggerClass();
  const line = rec.lines.find((l) => l.speaker === speakerKey);
  const label = line ? speakerLabelFor(line, rec.speakerCounts, rec.speakers, rec.roster, rec.speakerNames) : speakerKey;
  const [editingOther, setEditingOther] = useState(false);
  const [otherText, setOtherText] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchMember[]>([]);
  const searchSeq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < SEARCH_MIN_CHARS) {
      setResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    const timer = setTimeout(() => {
      void searchLabMembers(q).then((members) => {
        if (seq === searchSeq.current) setResults(members);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  if (!rec.canEdit) {
    return <span className="rounded-full bg-os-container px-2 py-0.5 text-xs">{label}</span>;
  }

  const assigned = rec.speakers[speakerKey];
  const rosterOptions: SelectOption[] = rec.roster.map((r) => ({
    value: r.userId,
    label: r.name,
    description: "In this meeting",
  }));
  const searchOptions: SelectOption[] = results
    .filter((m) => !rec.roster.some((r) => r.userId === m.id))
    .map((m) => ({ value: m.id, label: m.name }));
  const options: SelectOption[] = [
    ...rosterOptions,
    ...searchOptions,
    { value: SOMEONE_ELSE, label: "Someone else…" },
  ];
  const value = options.some((o) => o.value === assigned) ? assigned! : "";

  function handleChange(next: string) {
    if (next === SOMEONE_ELSE) {
      setEditingOther(true);
      return;
    }
    setEditingOther(false);
    const picked = rec.roster.find((r) => r.userId === next) ?? results.find((m) => m.id === next);
    void rec.setSpeaker(speakerKey, next, picked?.name);
  }

  return (
    <div className="flex flex-col gap-1">
      <Combobox
        value={value}
        onChange={handleChange}
        onQueryChange={setQuery}
        options={options}
        placeholder={label}
        ariaLabel={`Rename ${label}`}
        emptyLabel={query.trim().length >= SEARCH_MIN_CHARS ? "No matches" : "Type to search lab members"}
        className={triggerClass}
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
