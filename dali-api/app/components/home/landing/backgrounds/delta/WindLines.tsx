import type { CSSProperties } from 'react'

/**
 * The wind: six line vectors from the Figma file, drawn on and off along their own paths.
 *
 * Each streak is a single stroke with pathLength normalised to 1000, so one set of dash numbers
 * works for all of them however long the curve really is. A dash a few hundred units long is
 * swept from before the start of the path to past its end, which draws the line on at the head
 * while it rubs out at the tail -- a gust running the length of the curve. The streaks run on
 * durations that don't divide into each other, so the wind never falls into a pattern.
 *
 * The paths come from the "MacBook Pro 14" - 11" frame, where they sit over a 1512x982 sky. Each
 * carries the offset that puts it back where it was in that frame, and the group transform then
 * lays that frame over the 3985x1594 delta: scaled to its width, and lifted so the band of
 * curves sits across the middle of the landscape rather than low in it.
 */
export default function WindLines() {
  return (
    <svg
      className="landing-layer delta-wind"
      viewBox="0 0 3985 1594"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <g transform="scale(2.6356) translate(0 -148)">
        {STREAKS.map((streak) => (
          <path
            key={streak.node}
            d={streak.d}
            pathLength={1000}
            transform={`translate(${streak.x} ${streak.y})`}
            className={`delta-wind-line delta-wind-${streak.weight}`}
            style={streakStyle(streak)}
          />
        ))}
      </g>
    </svg>
  )
}

/** The streaks, back to front, exactly as exported. */
const STREAKS = [
  {
    // Vector 46 (410:854), a background thread
    node: '410:854',
    y: 196.569,
    x: -0.000,
    weight: 'faint',
    dash: 300,
    duration: 13.5,
    delay: -6.5,
    d: 'M2524 1.43113C2132 1.43114 1780 74.9312 1509.5 74.9312C1239 74.9312 1018 -11.5688 802 1.43113C586 14.4311 497.37 137.377 290 142.931C170.173 146.14 104.616 116.22 -15 108.431C-297.462 90.0395 -459.566 97.764 -739 142.931',
  },
  {
    // Vector 47 (416:860), the heavy foreground streak
    node: '416:860',
    y: 348.501,
    x: -0.000,
    weight: 'bold',
    dash: 430,
    duration: 17.0,
    delay: 1.5,
    d: 'M3090.5 7.12489C3090.5 7.12489 2402.31 104.053 1959 99.125C1568.99 94.7891 1223.5 -21.8751 964.5 7.12489C705.5 36.1249 505.069 156.767 284.5 150.851C63.9309 144.935 -254 70.3511 -254 70.3511',
  },
  {
    // Vector 42 (410:848), a background thread
    node: '410:848',
    y: 378.900,
    x: 4.976,
    weight: 'faint',
    dash: 260,
    duration: 11.5,
    delay: -3.0,
    d: 'M1507.02 51.3739C1507.02 51.3739 1094.02 -22.1261 835.024 6.87391C576.024 35.8739 508.593 154.29 288.024 148.374C173.945 145.314 0.0244141 98.8739 0.0244141 98.8739',
  },
  {
    // Vector 48 (419:862), the heavy foreground streak
    node: '419:862',
    y: 456.500,
    x: -0.000,
    weight: 'bold',
    dash: 470,
    duration: 19.5,
    delay: 6.5,
    d: 'M2396.5 197.686C2396.5 197.686 2019.5 -85.202 1701 30.1489C1499.12 103.264 1221.7 195.338 1007 197.686C760.603 200.379 632.899 80.7519 386.5 83.1855C140.101 85.6192 -415.202 257.874 -632.5 240.649C-849.798 223.424 -1168 83.1855 -1168 83.1855',
  },
  {
    // Vector 44 (410:851), a background thread
    node: '410:851',
    y: 466.268,
    x: -0.000,
    weight: 'faint',
    dash: 240,
    duration: 15.5,
    delay: -12.0,
    d: 'M1503.5 153.732C1301.99 108.431 1171.5 37.7316 987.5 37.7316C803.5 37.7316 618 147.232 571.5 153.732C525 160.232 444 164.232 427 102.732C410 41.2317 478 6.23152 523 0.731549C568 -4.76842 629.5 26.2315 629.5 71.2316C629.5 116.232 523.266 173.181 427 201.232C321.026 232.111 255.229 247.646 146 231.732C80.7799 222.229 44.0047 211.072 -15.5 182.732',
  },
  {
    // Vector 45 (410:852), a background thread
    node: '410:852',
    y: 533.363,
    x: -0.000,
    weight: 'faint',
    dash: 280,
    duration: 12.5,
    delay: 4.0,
    d: 'M1502.5 16.6366C1300.62 89.7512 1176.2 112.29 961.5 114.637C715.103 117.33 587.399 -2.29701 341 0.136612C201.792 1.51154 122.665 10.8994 -13 42.1366',
  },
] as const

function streakStyle(streak: (typeof STREAKS)[number]): CSSProperties {
  return {
    '--dash': streak.dash,
    '--dur': `${streak.duration}s`,
    '--delay': `${streak.delay}s`,
  } as CSSProperties
}
