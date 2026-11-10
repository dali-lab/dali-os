import { Button } from "~/components/ui/Button";
import { Toggle } from "~/components/ui/Toggle";
import type { PollSpec } from "~/components/slides/deck/content";
import type { PollsState } from "./polls";

export interface SlidePoll {
  id: string;
  poll: PollSpec;
}

export interface PresenterPollsProps {
  polls: SlidePoll[];
  state: PollsState;
  reactionsOff: boolean;
  joinHidden?: boolean;
  onJoinHidden?: (hidden: boolean) => void;
  onClose: (id: string) => void;
  onOpen: (id: string) => void;
  onReset: (id: string) => void;
  onReactionsOff: (off: boolean) => void;
}

/** Live vote counts for the polls on this slide, with the presenter's controls over voting and reactions. */
export function PresenterPolls({ polls, state, reactionsOff, joinHidden = false, onJoinHidden, onClose, onOpen, onReset, onReactionsOff }: PresenterPollsProps) {
  return (
    <div className="flex flex-col gap-3" data-testid="presenter-polls">
      <Toggle tone="os" label="Allow reactions" checked={!reactionsOff} onChange={(e) => onReactionsOff(!e.target.checked)} />
      {polls.length > 0 && onJoinHidden && <Toggle tone="os" label="Show join code" checked={!joinHidden} onChange={(e) => onJoinHidden(!e.target.checked)} />}
      {polls.map(({ id, poll }) => {
        const result = state.polls[id];
        const closed = result?.closed ?? false;
        return (
          <section key={id} className="flex flex-col gap-2 rounded-os-item border border-os-container bg-os-card p-3" data-poll={id}>
            <h3 className="text-sm font-medium text-os-fg">{poll.question}</h3>
            <ul className="flex flex-col gap-1 text-xs text-os-grey">
              {poll.options.map((option, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="truncate">{option}</span>
                  <span className="tabular-nums text-os-fg" data-poll-count={i}>
                    {result?.counts[i] ?? 0}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-os-grey">
                {result?.total ?? 0} {(result?.total ?? 0) === 1 ? "vote" : "votes"}
              </span>
              <span className="flex gap-1">
                <Button variant="secondary" size="xs" onClick={() => (closed ? onOpen(id) : onClose(id))}>
                  {closed ? "Reopen voting" : "Close voting"}
                </Button>
                <Button variant="ghost" size="xs" onClick={() => onReset(id)} disabled={(result?.total ?? 0) === 0}>
                  Reset
                </Button>
              </span>
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function pollsOnSlide(elements: Array<{ id: string; kind: string; poll?: PollSpec }> | undefined): SlidePoll[] {
  return (elements ?? []).flatMap((e) => (e.kind === "poll" && e.poll ? [{ id: e.id, poll: e.poll }] : []));
}
