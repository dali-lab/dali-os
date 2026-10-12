import { useCallback, useState } from 'react'
import blocksMarkup from '~/assets/landing/blocks.svg?raw'
import TetrisGame from './tetris/TetrisGame'
import './week5.css'

/**
 * Full-bleed background for the week 5 milestone: the build, drawn as a board of falling blocks,
 * from the Figma export "Week5_Milestone" (4075x1545).
 *
 * Two things live here. The first is the art's own animation: Figma wrote it as a <style> block
 * inside the SVG -- sixteen groups, each with a transform and an opacity track, all on one 18s
 * linear loop. Nothing here drives it, and nothing here should.
 *
 * The second is a real game. The looping board is an attract mode: it plays itself until someone
 * presses the blinking button, and then it stands down and a playfield takes its place. Pressing
 * escape, or finishing, brings it back.
 *
 * The art has to be inlined rather than loaded as an <img>, which is what the other weeks do.
 * An SVG referenced by <img> is rendered in its own context with scripting and external state
 * shut out, and its stylesheet never runs: the board would come out frozen on its first frame.
 * Inlining puts the export's <style> into the page, where it animates.
 *
 * scripts/prep-week5-art.py has already taken the milestone number, title and body copy out of
 * the export. Those are live text in the landing chrome; keeping the drawn copies would have
 * meant two of each, and the drawn ones still read "Week 1".
 */
export default function Week5Background() {
  const [playing, setPlaying] = useState(false)
  // Stable, so the effect in the game that reports its phase does not re-run every render.
  const handlePhase = useCallback((isPlaying: boolean) => setPlaying(isPlaying), [])

  return (
    <div className="landing-background landing-week5 landing-animated">
      <div
        className={`w5-board${playing ? ' w5-board-standby' : ''}`}
        aria-hidden="true"
        // The markup is a build-time import of a file in this repo, not anything user-supplied.
        dangerouslySetInnerHTML={{ __html: blocksMarkup }}
      />
      <div className="landing-scrim" />
      <TetrisGame onPhaseChange={handlePhase} />
    </div>
  )
}
