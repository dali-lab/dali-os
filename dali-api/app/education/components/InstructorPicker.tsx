import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Avatar } from "~/components/ui/Avatar";
import { SearchInput } from "~/components/ui/SearchInput";

// Assigning instructors is a search, not a survey. The previous control listed
// every lab member as a checkbox in a scrolling grid, which is fine at a dozen
// people and unusable at a few hundred — you scan for one name you already
// know. Here the current instructors are the visible state, and adding one
// means typing part of their name.
//
// Candidates are filtered in the browser: the loader already sends just id +
// name, so the whole roster is a few KB and a round-trip per keystroke would
// buy nothing.

export type InstructorCandidate = { id: string; name: string };

const MAX_RESULTS = 8;

export function InstructorPicker({
  candidates,
  initialSelectedIds,
}: {
  candidates: InstructorCandidate[];
  initialSelectedIds: string[];
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds);
  const [query, setQuery] = useState("");

  const byId = useMemo(
    () => new Map(candidates.map((c) => [c.id, c])),
    [candidates],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return candidates
      .filter((c) => !selectedIds.includes(c.id) && c.name.toLowerCase().includes(q))
      .slice(0, MAX_RESULTS);
  }, [query, candidates, selectedIds]);

  function add(id: string) {
    setSelectedIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    setQuery("");
  }

  return (
    <div className="flex flex-col gap-2">
      {/* One hidden input per selection — the form still posts `userIds`, so the
          action is unchanged. No selections posts nothing, which clears the
          list, exactly as unchecking every box used to. */}
      {selectedIds.map((id) => (
        <input key={id} type="hidden" name="userIds" value={id} />
      ))}

      {selectedIds.length === 0 ? (
        <p className="text-sm italic text-os-grey">
          No instructors yet. Search below to add one.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {selectedIds.map((id) => (
            <li
              key={id}
              className="inline-flex items-center gap-1.5 rounded-full bg-os-well px-3 py-1.5 text-sm text-foreground"
            >
              <Avatar name={byId.get(id)?.name ?? "?"} size="xs" />
              <span className="truncate">{byId.get(id)?.name ?? "Unknown member"}</span>
              <button
                type="button"
                aria-label={`Remove ${byId.get(id)?.name ?? "instructor"}`}
                onClick={() => setSelectedIds((ids) => ids.filter((x) => x !== id))}
                className="text-os-grey hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <label htmlFor="instructor-search" className="sr-only">
          Search members to add as instructors
        </label>
        <SearchInput
          id="instructor-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search members by name…"
          size="sm"
          containerClassName="w-full sm:max-w-sm"
        />
        {query.trim() !== "" && (
          <ul className="mt-2 flex flex-col gap-0.5 rounded-os-item bg-os-well p-1.5 sm:max-w-sm">
            {results.length === 0 ? (
              <li className="px-2.5 py-2 text-sm italic text-os-grey">
                No members match that name.
              </li>
            ) : (
              results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => add(c.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-os-container"
                  >
                    <Avatar name={c.name} size="xs" />
                    {c.name}
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
