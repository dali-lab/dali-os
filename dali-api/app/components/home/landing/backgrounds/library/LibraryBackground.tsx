import { useRef } from 'react'
import LibraryRoom from './art/LibraryRoom'
import ClockHands from './ClockHands'
import FloatingGems from './FloatingGems'
import LampLights from './LampLights'
import { useLandingScene } from './useLandingScene'
import WindowSky from './WindowSky'
import './library.css'

/**
 * Full-bleed late-night library background, built for smooth animation:
 *
 * - The room is one static SVG image, drawn once.
 * - Everything that moves (lamp light, gems, moonlight, stars) is its own small, pre-rendered
 *   sprite, so the GPU animates it with transform/opacity and nothing gets repainted.
 * - Two parallax groups (the scene, and the closer gems) move as single GPU layers.
 * - Dust and gem trails are drawn on canvases at reduced resolution and frame rate.
 *
 * Sprites are placed in the frame's coordinates with the same cover scaling as the room, so
 * everything stays aligned at any window size. A scrim on top keeps the text readable.
 */
export default function LibraryBackground() {
  const rootRef = useRef<HTMLDivElement>(null)
  useLandingScene(rootRef)

  return (
    <div ref={rootRef} className="landing-background landing-animated">
      <div className="landing-parallax landing-parallax-far">
        <LibraryRoom className="landing-layer" />
        <WindowSky />
        <LampLights />
        <canvas className="landing-layer landing-dust" />
        <ClockHands />
      </div>
      <div className="landing-parallax landing-parallax-near">
        <canvas className="landing-layer landing-trails" />
        <FloatingGems />
      </div>
      <div className="landing-scrim" />
    </div>
  )
}
