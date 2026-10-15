import { useEffect, useRef } from 'react'
import { useFeatureFlag } from '~/components/FeatureFlags'
import Leaderboard from './Leaderboard'
import TetrisBoard, { NextQueue } from './TetrisBoard'
import { useLeaderboard } from './useLeaderboard'
import { useTetris } from './useTetris'
import './tetris.css'

/**
 * The game that lives on the week 5 landing page.
 *
 * It starts as a single blinking button over the looping board art. Pressing it swaps the
 * decoration for a real playfield; quitting puts the decoration back. Everything the game draws
 * is inside one element that the page can hide, so the landing is unchanged when nobody plays.
 */
export default function TetrisGame({ onPhaseChange }: { onPhaseChange?: (playing: boolean) => void }) {
  const { game, phase, start, quit, togglePause, act } = useTetris()
  const idle = phase === 'idle'
  const scoresEnabled = useFeatureFlag('landing-leaderboard')
  const board = useLeaderboard(scoresEnabled)
  const { submit, clearPersonalBest } = board

  // Report the run once it is over, and only once: `phase` is derived from a
  // game that is mutated in place, so this effect re-runs on re-renders that
  // happen to land while the card is still up.
  const reported = useRef(false)
  useEffect(() => {
    if (phase !== 'over') {
      reported.current = false
      return
    }
    if (reported.current || !scoresEnabled) return
    reported.current = true
    void submit({ score: game.score, lines: game.lines, level: game.level })
  }, [phase, scoresEnabled, submit, game])

  // Let the page know whether to keep showing the decorative board behind us. In an effect
  // rather than in the render body: telling a parent to re-render while this one is still
  // rendering is how you get React warning about a cascading update.
  useEffect(() => {
    onPhaseChange?.(!idle)
  }, [idle, onPhaseChange])

  const playAgain = () => {
    clearPersonalBest()
    start()
  }

  if (idle) {
    return (
      <div className="t-stage t-stage-idle">
        <button type="button" className="t-play" onClick={playAgain}>
          {/* Four loose blocks pinned to the corners, one per piece colour. Decoration only,
              so they are spans rather than anything the game knows about. */}
          <span className="t-play-chip t-play-chip-tl" aria-hidden="true" />
          <span className="t-play-chip t-play-chip-tr" aria-hidden="true" />
          <span className="t-play-chip t-play-chip-bl" aria-hidden="true" />
          <span className="t-play-chip t-play-chip-br" aria-hidden="true" />
          <span className="t-play-face">
            <span className="t-play-mark" aria-hidden="true" />
            <span className="t-play-word">Press Start</span>
          </span>
          {/* Kept to plain ASCII: the pixel face has no arrow glyphs and silently falls back
              to another font for them, which shows up as a row of boxes. */}
          <span className="t-play-sub" aria-hidden="true">1 player - arrows to move</span>
        </button>
        {scoresEnabled && <Leaderboard board={board} limit={5} />}
      </div>
    )
  }

  return (
    <div className="t-stage">
      <div className="t-frame">
        <TetrisBoard game={game} />

        {phase === 'paused' && (
          <div className="t-overlay">
            <p className="t-overlay-title">Paused</p>
            <button type="button" className="t-button" onClick={togglePause}>
              Resume
            </button>
          </div>
        )}

        {phase === 'over' && (
          <div className="t-overlay">
            <p className="t-overlay-title">Game over</p>
            <p className="t-overlay-score">
              {game.score.toLocaleString()}
              <span> points</span>
            </p>
            {scoresEnabled && (
              <>
                {board.personalBest && <p className="t-overlay-best">New personal best</p>}
                <Leaderboard board={board} />
              </>
            )}
            <div className="t-overlay-actions">
              <button type="button" className="t-button" onClick={playAgain}>
                Play again
              </button>
              <button type="button" className="t-button t-button-quiet" onClick={quit}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="t-hud">
        <Readout label="Score" value={game.score.toLocaleString()} />
        <Readout label="Lines" value={String(game.lines)} />
        <Readout label="Level" value={String(game.level)} />
        <div className="t-hud-next">
          <span className="t-readout-label">Next</span>
          <NextQueue next={game.next} />
        </div>
        {/*
          Touch controls. A phone has no arrow keys, and without these the game is something you
          can start on a phone and then only watch. They are hidden wherever a fine pointer and a
          keyboard are available, so the desktop keeps its uncluttered board.
        */}
        <div className="t-pad">
          <PadButton label="Left" glyph="←" onPress={() => act('left')} />
          <PadButton label="Rotate" glyph="⟳" onPress={() => act('rotate')} />
          <PadButton label="Right" glyph="→" onPress={() => act('right')} />
          <PadButton label="Soft drop" glyph="↓" onPress={() => act('down')} />
          <PadButton label="Hard drop" glyph="⤓" onPress={() => act('slam')} wide />
        </div>

        <p className="t-keys">
          <kbd>←</kbd><kbd>→</kbd> move · <kbd>↓</kbd> drop · <kbd>↑</kbd> rotate ·{' '}
          <kbd>space</kbd> slam · <kbd>P</kbd> pause · <kbd>esc</kbd> quit
        </p>
      </div>
    </div>
  )
}

/**
 * One key on the touch pad. It fires on pointerdown rather than click so a tap registers at the
 * moment the finger lands, which is the difference between the controls feeling immediate and
 * feeling like they lag; and it never takes focus, so the page does not scroll to it mid-game.
 */
function PadButton({
  label,
  glyph,
  onPress,
  wide,
}: {
  label: string
  glyph: string
  onPress: () => void
  wide?: boolean
}) {
  return (
    <button
      type="button"
      className={`t-pad-key${wide ? ' t-pad-key-wide' : ''}`}
      aria-label={label}
      onPointerDown={(event) => {
        event.preventDefault()
        onPress()
      }}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  )
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="t-readout">
      <span className="t-readout-label">{label}</span>
      <span className="t-readout-value">{value}</span>
    </div>
  )
}
