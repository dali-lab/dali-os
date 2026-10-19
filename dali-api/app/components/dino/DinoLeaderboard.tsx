import { visibleRows, type LeaderboardState } from "~/hooks/useLeaderboard";

export const DINO_BOARD_LIMIT = 5;

export function DinoLeaderboard({ board }: { board: LeaderboardState }) {
  const { shown, trailing } = visibleRows(board, DINO_BOARD_LIMIT);
  const youId = board.you?.userId;

  return (
    <aside aria-label="High scores" className="flex w-full shrink-0 flex-col gap-2 md:w-56">
      <p className="text-xs font-medium uppercase tracking-wide text-os-grey">High scores</p>
      {shown.length === 0 ? (
        <p className="text-sm text-os-grey">No scores yet. Set the first one.</p>
      ) : (
        <ol className="flex flex-col gap-1 text-sm tabular-nums">
          {shown.map((entry) => (
            <Row key={entry.userId} entry={entry} you={entry.userId === youId} />
          ))}
          {trailing && <Row entry={trailing} you adrift />}
        </ol>
      )}
    </aside>
  );
}

function Row({
  entry,
  you,
  adrift,
}: {
  entry: { rank: number; name: string; score: number };
  you: boolean;
  adrift?: boolean;
}) {
  return (
    <li
      className={`flex items-center gap-2 ${you ? "font-medium text-os-accent" : "text-foreground"} ${
        adrift ? "mt-1 border-t border-border pt-2" : ""
      }`}
    >
      <span className="w-6 shrink-0 text-right text-os-grey">{entry.rank}</span>
      <span className="min-w-0 flex-1 truncate">{you ? "You" : entry.name}</span>
      <span>{entry.score.toLocaleString()}</span>
    </li>
  );
}
