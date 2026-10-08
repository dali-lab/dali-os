import type { CSSProperties } from 'react'
import { WEEK4_LAYERS } from './week4Layers'
import { WEEK4_SPRITES } from './week4Sprites'
import './week4.css'

/**
 * Full-bleed background for the week 4 milestone: the DALI demo expo, from the Figma export
 * "Milestone_week_4" (4075×1545).
 *
 * The export is one flat drawing, so scripts/split-week4-layers.py takes it apart into the pieces
 * the room is built from -- the floor, each booth, and what stands on each booth -- and writes one
 * image per piece. They stack back to front into the same frame, so together they are the original
 * picture, and apart they can arrive one at a time. scripts/rasterize-week4-layers.mjs then turns
 * each piece into a WebP cropped to what it draws, so every animated layer is only as big as its
 * object rather than the whole window.
 *
 * The room builds itself: the floor fades up, the booths drop in from above left to right, then
 * everything standing on them falls into place, and from there each piece keeps drifting on its
 * own slow rhythm. Each layer is an image the browser draws once; the load-in and the drift are
 * transforms on top of it, so nothing is ever repainted. Two nested elements per piece, one
 * property each, so the drift never fights the fall.
 */
export default function Week4Background() {
  return (
    <div className="landing-background landing-week4 landing-animated">
      {WEEK4_LAYERS.map((layer, i) => (
        <div key={layer.name} className={`w4-layer w4-${layer.tier}`} style={layerStyle(layer, i)}>
          <img src={LAYER_URLS[layer.name]} alt="" draggable={false} decoding="async" className="w4-art" />
        </div>
      ))}
      <div className="landing-scrim" />
    </div>
  )
}

const LAYER_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../../../../../assets/landing/week4/layers/*.webp', {
      eager: true,
      query: '?url',
      import: 'default',
    }),
  ).map(([path, url]) => [path.split('/').pop()!.replace('.webp', ''), url]),
)

/**
 * When each part of the room arrives, in seconds, and how long it takes to fall.
 *
 * The room goes up the way it would be built: the floor, then the desk frames and signage, then
 * the surfaces onto them, then everything set out on top. Within a wave the pieces follow one
 * another at `step`, and `sway` pulls each one off that beat by a little so no two land together
 * and the spacing never settles into a metronome.
 */
const WAVES: Record<string, { start: number; step: number; fall: number }> = {
  grid: { start: 0, step: 0, fall: 0.95 },
  // The four desk frames follow one another, and the signage comes in among them rather than
  // after, so the first wave is a run of six arrivals instead of one.
  base: { start: 0.55, step: 0.19, fall: 0.95 },
  sign: { start: 1.08, step: 0.18, fall: 0.95 },
  top: { start: 1.62, step: 0.17, fall: 0.8 },
  object: { start: 2.42, step: 0.3, fall: 0.78 },
}

/**
 * Nudges, in seconds, applied in turn to successive layers. They are small, uneven and do not
 * repeat over the seven layers, so the stream of arrivals is irregular the way dropped things are
 * rather than evenly spaced. Fixed rather than random, so the page loads the same way every time.
 */
const SWAY = [0, 0.09, -0.06, 0.14, 0.12, 0.05, 0.17]

function layerStyle(layer: (typeof WEEK4_LAYERS)[number], i: number): CSSProperties {
  const tier = layer.tier
  const wave = WAVES[tier] ?? WAVES.object
  // Position within its own wave. The manifest is already ordered left to right within a tier.
  const rank = WEEK4_LAYERS.slice(0, i).filter((l) => l.tier === tier).length
  const delay = Math.max(0, wave.start + rank * wave.step + SWAY[i % SWAY.length])
  // Each piece falls at its own speed too, so even the ones that start together don't land
  // together. Heavier things -- the structure, the surfaces -- take longer.
  const duration = wave.fall * (0.88 + ((i * 3) % 5) * 0.06)
  // Taller pieces fall from higher up, so everything lands at about the same speed.
  const fall = tier === 'base' || tier === 'top' ? 48 : 30 + (layer.height / 1545) * 22
  const box = WEEK4_SPRITES[layer.name]
  return {
    '--x': box.x,
    '--y': box.y,
    '--w': box.w,
    '--h': box.h,
    '--delay': `${delay.toFixed(2)}s`,
    '--fall-dur': `${duration.toFixed(2)}s`,
    '--fall-from': `${fall.toFixed(0)}vh`,
    // The drift: a slow rise and settle, each piece on its own period and phase so the room never
    // breathes in unison. Bigger pieces move less, the way weight reads.
    '--float': `${(1.9 - Math.min(1, layer.height / 1100) * 0.9).toFixed(2)}vh`,
    '--float-dur': `${(5.2 + ((i * 7) % 5) * 0.8).toFixed(1)}s`,
    // Picks up once the piece has actually landed, not at a guessed moment.
    '--float-delay': `${(delay + duration + 0.2).toFixed(2)}s`,
  } as CSSProperties
}
