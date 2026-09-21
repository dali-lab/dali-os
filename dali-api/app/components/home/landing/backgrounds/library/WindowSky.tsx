import type { ReactNode } from 'react'
import { WINDOW_PANES } from './art/libraryGeometry'
import { ellipseBox, spriteStyle } from './sprite'

/** The window region of the frame; every window sprite is cropped to it. */
const WINDOW = { x: 1150, y: 150, w: 360, h: 660 }
/** Bounds of the three window panes (frame units), for scattering stars. */
const PANES = { x: 1205, y: 260, w: 240, h: 490 }
/** Stars twinkle in a few groups, each fading as one composited layer. */
const STAR_GROUPS = 4

/** Deterministic pseudo-random numbers, so the stars are the same on every render. */
function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const STARS = (() => {
  const rand = seeded(1789)
  return Array.from({ length: 40 }, (_, i) => ({
    x: PANES.x + rand() * PANES.w,
    y: PANES.y + rand() * PANES.h,
    r: 2 + rand() * 3.4,
    group: i % STAR_GROUPS,
  }))
})()

/** A <svg> cropped to the window region, clipped to the glass. */
function WindowLayer({ id, children }: { id: string; children: ReactNode }) {
  const clip = `landing-window-glass-${id}`
  return (
    <svg viewBox={`${WINDOW.x} ${WINDOW.y} ${WINDOW.w} ${WINDOW.h}`} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clip}>
          {WINDOW_PANES.map((pane, i) => (
            <path key={i} d={pane.d} transform={pane.transform} />
          ))}
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>{children}</g>
    </svg>
  )
}

/**
 * The night outside the library windows, screen-blended over the room: moonlight on the
 * glass and spilling into the room (fading as clouds pass), twinkling stars and an
 * occasional shooting star. Each part is its own small composited sprite, so the loops only
 * change opacity; nothing repaints except the shooting star while it streaks.
 */
export default function WindowSky() {
  return (
    <>
      <div
        className="landing-sprite landing-window landing-moon-spill"
        style={spriteStyle(ellipseBox(1330, 560, 300, 460))}
      />
      <div className="landing-sprite landing-window landing-moonlight" style={spriteStyle(WINDOW)}>
        <WindowLayer id="moon">
          <defs>
            <linearGradient id="landing-moon-pane" x1="0" y1="0" x2="0.35" y2="1">
              <stop offset="0" stopColor="#a9c8ff" stopOpacity="0.75" />
              <stop offset="0.6" stopColor="#6f8fd6" stopOpacity="0.32" />
              <stop offset="1" stopColor="#6f8fd6" stopOpacity="0.1" />
            </linearGradient>
          </defs>
          <rect x={WINDOW.x} y={WINDOW.y} width={WINDOW.w} height={WINDOW.h} fill="url(#landing-moon-pane)" />
        </WindowLayer>
      </div>
      {Array.from({ length: STAR_GROUPS }, (_, group) => (
        <div
          key={group}
          className="landing-sprite landing-window landing-stars"
          style={spriteStyle(WINDOW, { '--star-group': group })}
        >
          <WindowLayer id={`stars-${group}`}>
            {STARS.filter((star) => star.group === group).map((star, i) => (
              <circle key={i} cx={star.x} cy={star.y} r={star.r} fill="#ffffff" />
            ))}
          </WindowLayer>
        </div>
      ))}
      <div className="landing-sprite landing-window" style={spriteStyle(WINDOW)}>
        <WindowLayer id="shooting-star">
          <defs>
            <linearGradient id="landing-shooting-star" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0.95" />
            </linearGradient>
          </defs>
          {/* Crosses the panes now and then; landing.css times it. */}
          <g className="landing-shooting-star">
            <rect x={-170} y={-3} width={170} height={6} rx={3} fill="url(#landing-shooting-star)" />
            <circle r={5} fill="#ffffff" />
          </g>
        </WindowLayer>
      </div>
    </>
  )
}
