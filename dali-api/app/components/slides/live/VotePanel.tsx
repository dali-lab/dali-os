import { useContext } from "react";
import { PollContext, toggleChoice } from "~/components/slides/deck/content-render";
import { cn } from "~/lib/cn";
import { EMPTY_RESULT } from "./polls";
import type { SlidePoll } from "./PresenterPolls";

/** Poll choices as full-width buttons for phones, where the poll drawn on the slide is too small to tap. */
export function VotePanel({ polls }: { polls: SlidePoll[] }) {
  const ctx = useContext(PollContext);
  if (!ctx?.onVote || polls.length === 0) return null;
  const vote = ctx.onVote;
  return (
    <div className="absolute inset-x-2 bottom-24 z-10 flex max-h-[45%] flex-col gap-3 overflow-y-auto sm:hidden" data-testid="vote-panel">
      {polls.map(({ id, poll }) => {
        const result = ctx.results[id] ?? EMPTY_RESULT;
        return (
          <section key={id} className="flex flex-col gap-2 rounded-os-card border border-os-container bg-os-card p-3 shadow-lg" data-vote-poll={id}>
            <h3 className="text-sm font-semibold text-os-fg">{poll.question}</h3>
            {result.closed && <p className="text-xs text-os-grey">Voting is closed</p>}
            <div className="flex flex-col gap-1.5">
              {poll.options.map((option, i) => {
                const picked = result.mine.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={result.closed}
                    aria-pressed={picked}
                    data-vote-option={i}
                    onClick={() => vote(id, toggleChoice(result.mine, i, poll.multi === true))}
                    className={cn(
                      "min-h-11 rounded-os-item border px-3 text-left text-sm text-os-fg disabled:opacity-60",
                      picked ? "border-os-accent bg-os-hover" : "border-os-container hover:bg-os-hover",
                    )}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
