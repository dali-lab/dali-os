import Clouds from './Clouds'
import RiverFlow from './RiverFlow'
import ShoreWaves from './ShoreWaves'
import WindLines from './WindLines'
import src from '~/assets/landing/riverdelta.svg'
import './delta.css'

/**
 * Full-bleed river-delta background for the week 3 milestone, from the Figma frame
 * "Frame 197 – Delta Vectorized (Polished)" (3985×1594).
 *
 * The delta itself is one static SVG image, drawn once and never repainted. Over it, in order of
 * how near they are to the viewer: the current running up the channels and the surf washing up
 * the beach, then the wind crossing above the land, then the clouds passing over all of it. The
 * water and the wind are framed with the art, so they stay pinned to the landscape at any window
 * size; the clouds belong to the window. A scrim on top keeps the text readable.
 */
export default function DeltaBackground() {
  return (
    <div className="landing-background landing-delta landing-animated">
      <img src={src} alt="" draggable={false} className="landing-layer" />
      <RiverFlow />
      <ShoreWaves />
      <WindLines />
      <Clouds />
      <div className="landing-scrim" />
    </div>
  )
}
