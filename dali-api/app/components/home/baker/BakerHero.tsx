import { useEffect, useState, type ReactNode } from 'react'
import { bakerScene } from './scene'
import './baker.css'

const ART: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../../../assets/landing/baker/*.svg', {
      eager: true,
      query: '?url',
      import: 'default',
    }),
  ).map(([path, url]) => [path.split('/').pop()!.replace('.svg', ''), url]),
)

// Where the art draws Baker's two clock faces (the left one is foreshortened).
const CLOCKS = [
  { cx: 919, cy: 398, r: 19, sx: 0.66 },
  { cx: 990, cy: 402, r: 19, sx: 0.95 },
]

/** Baker tower over the Green in Hanover's current season, by day or night, with the clock showing Hanover time. */
export default function BakerHero({
  now,
  greeting,
  detail,
  action,
}: {
  now: number
  greeting: string
  detail?: string
  action?: ReactNode
}) {
  const [time, setTime] = useState(now)
  useEffect(() => {
    const id = setInterval(() => setTime(Date.now()), 30_000)
    setTime(Date.now())
    return () => clearInterval(id)
  }, [])

  const scene = bakerScene(new Date(time))
  const hourDeg = (scene.hour % 12) * 30 + scene.minute / 2
  const minuteDeg = scene.minute * 6

  return (
    <section
      className="baker-hero"
      data-season={scene.season}
      data-night={scene.night || undefined}
      aria-label={`Baker tower, ${scene.season} ${scene.night ? 'night' : 'day'}`}
    >
      <svg className="baker-art" viewBox="0 0 1144 520" preserveAspectRatio="xMaxYMax slice" aria-hidden>
        <image href={ART[`${scene.season}-${scene.night ? 'night' : 'day'}`]} width="1144" height="520" />
        {CLOCKS.map((c) => (
          <g key={c.cx} transform={`translate(${c.cx} ${c.cy}) scale(${c.sx} 1)`} className="baker-hands">
            <line y2={-c.r * 0.5} strokeWidth="3" transform={`rotate(${hourDeg})`} />
            <line y2={-c.r * 0.78} strokeWidth="2" transform={`rotate(${minuteDeg})`} />
          </g>
        ))}
      </svg>
      <div className="baker-copy">
        <p className="baker-overline">Hanover · {scene.label}</p>
        <h1 className="baker-heading">{greeting}</h1>
        {detail && <p className="baker-detail">{detail}</p>}
        {action}
      </div>
    </section>
  )
}
