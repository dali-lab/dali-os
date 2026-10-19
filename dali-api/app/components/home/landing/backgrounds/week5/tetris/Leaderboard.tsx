import { visibleRows, type LeaderboardState } from '~/hooks/useLeaderboard'

/**
 * The high-score board, drawn as a cabinet would draw it: rank, name, score.
 *
 * It appears in two places and they want different amounts of it -- a short
 * list on the attract screen, where it is one thing among several, and the full
 * board on the game-over card, where it is the point. `limit` is the only
 * difference between them.
 */
export default function Leaderboard({
  board,
  limit,
  title = 'High scores',
}: {
  board: LeaderboardState
  limit?: number
  title?: string
}) {
  const { shown, trailing } = visibleRows(board, limit)

  if (board.loading) {
    return (
      <div className="t-scores">
        <p className="t-scores-title">{title}</p>
        <p className="t-scores-empty">Loading…</p>
      </div>
    )
  }

  return (
    <div className="t-scores">
      <p className="t-scores-title">{title}</p>
      {shown.length === 0 ? (
        <p className="t-scores-empty">No scores yet — be the first.</p>
      ) : (
        <ol className="t-scores-list">
          {shown.map((entry) => (
            <Row key={entry.userId} entry={entry} you={entry.userId === board.you?.userId} />
          ))}
          {trailing && <Row key={trailing.userId} entry={trailing} you adrift />}
        </ol>
      )}
    </div>
  )
}

function Row({
  entry,
  you,
  adrift,
}: {
  entry: { rank: number; name: string; score: number }
  you: boolean
  /* Sat below the listed places rather than among them, so the gap in the
     ranks reads as a gap rather than as a mistake. */
  adrift?: boolean
}) {
  return (
    <li className={`t-scores-row${you ? ' t-scores-row-you' : ''}${adrift ? ' t-scores-row-adrift' : ''}`}>
      <span className="t-scores-rank">{entry.rank}</span>
      <span className="t-scores-name">{you ? 'You' : entry.name}</span>
      <span className="t-scores-score">{entry.score.toLocaleString()}</span>
    </li>
  )
}
