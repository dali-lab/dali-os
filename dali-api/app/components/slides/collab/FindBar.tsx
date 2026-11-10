import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { SearchInput } from "~/components/ui/SearchInput";
import { Toggle } from "~/components/ui/Toggle";
import type { DeckFind } from "./useDeckFind";

export function FindBar({ find }: { find: DeckFind }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [find.focusKey]);
  const total = find.matches.length;
  const status = find.query === "" ? "" : total === 0 ? "No matches" : `${find.current + 1} of ${total}`;
  return (
    <div role="search" aria-label="Find and replace" data-find-bar className="absolute right-4 top-2 z-20 flex w-80 flex-col gap-2 rounded-os-card border border-os-container bg-os-card p-2 shadow-lg">
      <div className="flex items-center gap-1">
        <SearchInput
          ref={input}
          size="sm"
          value={find.query}
          onChange={(e) => find.setQuery(e.target.value)}
          placeholder="Find"
          aria-label="Find"
          containerClassName="min-w-0 flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.preventDefault(), e.shiftKey ? find.prev() : find.next());
            else if (e.key === "Escape") (e.preventDefault(), find.close());
          }}
        />
        <span aria-live="polite" data-find-status className="w-16 shrink-0 text-right text-xs text-os-grey">
          {status}
        </span>
        <IconButton label="Previous match" icon={ChevronUp} disabled={total === 0} onClick={find.prev} />
        <IconButton label="Next match" icon={ChevronDown} disabled={total === 0} onClick={find.next} />
        <IconButton label="Close find" icon={X} onClick={find.close} />
      </div>
      <SearchInput
        size="sm"
        value={find.replacement}
        onChange={(e) => find.setReplacement(e.target.value)}
        placeholder="Replace with"
        aria-label="Replace with"
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.preventDefault(), find.replaceCurrent());
          else if (e.key === "Escape") (e.preventDefault(), find.close());
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <Toggle tone="os" label="Match case" checked={find.matchCase} onChange={(e) => find.setMatchCase(e.target.checked)} />
        <div className="flex gap-1.5">
          <Button variant="secondary" size="xs" disabled={total === 0} onClick={find.replaceCurrent}>
            Replace
          </Button>
          <Button variant="secondary" size="xs" disabled={total === 0} onClick={find.replaceAll}>
            Replace all
          </Button>
        </div>
      </div>
    </div>
  );
}
