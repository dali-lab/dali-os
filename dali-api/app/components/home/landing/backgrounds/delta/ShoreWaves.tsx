import type { CSSProperties } from 'react'
import { WAVE_CRESTS } from './waveCrests'

/**
 * Surf washing up the beach in the top left.
 *
 * The crests are contours of distance from the shore, traced out of the illustration by
 * scripts/trace-delta-water.py, so each one runs parallel to the beach and follows every bend of
 * it rather than cutting across the sand.
 *
 * A wave breaks in two motions at once. The crest draws itself on along its length, which runs the
 * line of foam sideways down the beach, then holds and fades where it lies. At the same time it
 * slides shorewards -- each crest carries the direction the land lies in, so the slide follows the
 * coast instead of being one fixed direction. The crests are delayed by how far out they sit,
 * furthest first, so a set of them breaks in sequence and the sea washes up in trains.
 */
export default function ShoreWaves() {
  // Where each crest sits between the nearest and the furthest, rather than as a share of the
  // furthest: the set then spans the full range of weight and timing whichever levels the tracer
  // was asked for, instead of bunching up when they are all a similar distance out.
  const offshore = WAVE_CRESTS.map((wave) => wave.offshore)
  const nearest = Math.min(...offshore)
  const span = Math.max(...offshore) - nearest || 1

  return (
    <svg
      className="landing-layer delta-surf"
      viewBox="0 0 3985 1594"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {WAVE_CRESTS.map((wave) => (
        <g key={wave.id} className="delta-wave" style={waveStyle(wave, (wave.offshore - nearest) / span)}>
          <path d={wave.d} pathLength={1000} className="delta-wave-crest" />
        </g>
      ))}
    </svg>
  )
}

/** How far a crest slides up the beach as it breaks, in frame units. */
const WASH = 24
/** Seconds from one train of waves to the next. */
const PERIOD = 8.5
/** Seconds from the outermost crest breaking to the innermost. */
const TRAIN = 3.2

/** `out` is 0 for the crest nearest the beach and 1 for the one furthest out. */
function waveStyle(wave: (typeof WAVE_CRESTS)[number], out: number): CSSProperties {
  return {
    // Shoreward, in the art's own units: px inside the SVG are user units, so this scales with it.
    '--wash': `${(wave.toLand.x * WASH).toFixed(1)}px ${(wave.toLand.y * WASH).toFixed(1)}px`,
    '--dur': `${PERIOD}s`,
    // The crest furthest out breaks first and the rest follow it in. The extra second back starts
    // the first train already part-way through, so the beach isn't still when the page arrives.
    '--delay': `${(1 - out) * TRAIN - 1.2}s`,
    // Foam is brightest and heaviest where the water is shallowest.
    '--alpha': 0.8 - out * 0.34,
    '--width': 3 - out * 1.4,
  } as CSSProperties
}
