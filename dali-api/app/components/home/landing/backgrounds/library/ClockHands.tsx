import { useEffect, useState } from 'react'
import { spriteStyle } from './sprite'

/*
 * The wall clock hangs on an angled wall, so its face is an ellipse. Hands are drawn on an
 * upright circle and squashed horizontally by FACE_ASPECT, which foreshortens them like the
 * painted face. Centre and aspect are measured from the clock art (hub Vector_755, hour
 * marks Vector_750–753), in frame units.
 */
const CENTER = { x: 904.5, y: 120.5 }
const FACE_ASPECT = 0.61
const HUB = { rx: 9.5, ry: 15.5 }
/** The clock face region; the hands are drawn in a sprite cropped to it. */
const FACE = { x: 840, y: 40, w: 130, h: 165 }

function handAngles(now: Date) {
  const seconds = now.getSeconds()
  const minutes = now.getMinutes() + seconds / 60
  const hours = (now.getHours() % 12) + minutes / 60
  return { hour: hours * 30, minute: minutes * 6, second: seconds * 6 }
}

/**
 * Live hour, minute and ticking second hands for the library's wall clock, in a small sprite
 * cropped to the face so each tick repaints only that.
 */
export default function ClockHands() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    // Tick on the second boundary so the second hand stays in step with the real clock.
    let interval: number | undefined
    const timeout = window.setTimeout(() => {
      setNow(new Date())
      interval = window.setInterval(() => setNow(new Date()), 1000)
    }, 1000 - (Date.now() % 1000))
    return () => {
      window.clearTimeout(timeout)
      window.clearInterval(interval)
    }
  }, [])

  const { hour, minute, second } = handAngles(now)

  return (
    <div className="landing-sprite" style={spriteStyle(FACE)}>
      <svg viewBox={`${FACE.x} ${FACE.y} ${FACE.w} ${FACE.h}`} aria-hidden="true" focusable="false">
        <g transform={`translate(${CENTER.x} ${CENTER.y}) scale(${FACE_ASPECT} 1)`} strokeLinecap="round">
          <line transform={`rotate(${hour})`} y1={7} y2={-38} stroke="#0c1932" strokeWidth={9} />
          <line transform={`rotate(${minute})`} y1={9} y2={-58} stroke="#0c1932" strokeWidth={7} />
          <line
            className="landing-clock-second"
            transform={`rotate(${second})`}
            y1={14}
            y2={-62}
            stroke="#e7cc7f"
            strokeWidth={2.4}
          />
        </g>
        {/* The hub, redrawn over the hands (shadow, then cap), as in the original art. */}
        <ellipse cx={CENTER.x - 4} cy={CENTER.y} rx={HUB.rx} ry={HUB.ry} fill="#0c1932" />
        <ellipse cx={CENTER.x} cy={CENTER.y} rx={HUB.rx} ry={HUB.ry} fill="#03284d" />
      </svg>
    </div>
  )
}
