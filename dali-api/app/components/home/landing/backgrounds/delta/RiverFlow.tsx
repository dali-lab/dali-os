import type { CSSProperties } from 'react'
import { RIVER_CHANNELS } from './riverChannels'

/**
 * The current: dashes running downstream along the delta's channels.
 *
 * The channels are centrelines traced out of the illustration itself by
 * scripts/trace-delta-water.py, so each line runs exactly down the middle of the water it belongs
 * to, meander for meander, and points the way that stretch actually drains.
 *
 * Where the wind is a single gust sweeping a curve end to end, a river doesn't gust — so these
 * use a repeating dash instead, a train of them sliding downstream and picked up seamlessly by
 * travelling exactly one dash-and-gap per cycle. The dash and the gap are set in frame units and
 * converted per channel, so every channel is dashed at the same physical size and the whole delta
 * reads as one body of water rather than as six separate animations.
 */
export default function RiverFlow() {
  return (
    <svg
      className="landing-layer delta-flow"
      viewBox="0 0 3985 1594"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {RIVER_CHANNELS.map((channel, i) => (
        <path
          key={channel.id}
          d={channel.d}
          pathLength={1000}
          className="delta-flow-line"
          style={flowStyle(channel, i)}
        />
      ))}
    </svg>
  )
}

/** The lit part of the current, and the dark water between, in frame units. */
const DASH = 150
const GAP = 420
/** Seconds the current takes to travel one dash-and-gap, in a channel of average width. */
const PERIOD = 5.2

function flowStyle(channel: (typeof RIVER_CHANNELS)[number], i: number): CSSProperties {
  // pathLength is 1000 for every channel, so frame units have to be scaled into that.
  const perUnit = 1000 / channel.length
  // Wider water runs faster and shows more, the way it does in a real channel. 12 and 50 are
  // about the narrowest and widest half-widths the tracer finds in this delta.
  const depth = Math.min(1, Math.max(0, (channel.halfWidth - 12) / 38))
  return {
    '--dash': DASH * perUnit,
    '--gap': GAP * perUnit,
    // One dash-and-gap downstream: negative, because that is the way along the path.
    '--travel': -(DASH + GAP) * perUnit,
    '--dur': `${PERIOD * (1.18 - depth * 0.28)}s`,
    // Nothing divides evenly into anything else, so the channels never pulse together.
    '--delay': `${-i * 1.7 - 0.6}s`,
    '--alpha': 0.48 + depth * 0.32,
    '--width': 1.6 + depth * 1,
  } as CSSProperties
}
