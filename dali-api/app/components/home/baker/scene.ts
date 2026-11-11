export type BakerSeason = 'fall' | 'winter' | 'spring' | 'summer'

export type BakerScene = {
  season: BakerSeason
  night: boolean
  hour: number
  minute: number
  /** "Tuesday 4:10 PM", Hanover time. */
  label: string
}

const HANOVER = { lat: 43.7022, lon: -72.2896, timeZone: 'America/New_York' }

// Built from parts and joined with plain spaces: Node and browsers disagree on the
// space before AM/PM, which would break hydration.
const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: HANOVER.timeZone,
  weekday: 'long',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

export function bakerScene(date: Date): BakerScene {
  const parts = PARTS.formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  const hour12 = Number(get('hour'))
  const pm = get('dayPeriod').toUpperCase() === 'PM'
  const minute = Number(get('minute'))
  return {
    season: seasonOn(Number(get('month')), Number(get('day'))),
    night: isNightInHanover(date),
    hour: (hour12 % 12) + (pm ? 12 : 0),
    minute,
    label: `${get('weekday')} ${hour12}:${get('minute')} ${pm ? 'PM' : 'AM'}`,
  }
}

/** Hanover's seasons as the art shows them: snow from December through March, foliage from late September. */
export function seasonOn(month: number, day: number): BakerSeason {
  if (month === 12 || month <= 3) return 'winter'
  if (month <= 5) return 'spring'
  if (month < 9 || (month === 9 && day < 22)) return 'summer'
  return 'fall'
}

/** Dark from the end of civil dusk to the start of civil dawn in Hanover (NOAA solar approximation). */
export function isNightInHanover(date: Date): boolean {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1)
  const dayOfYear = Math.floor((date.getTime() - start) / 86_400_000) + 1
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1)
  const eqTime =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g))
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g)
  const rad = Math.PI / 180
  const lat = HANOVER.lat * rad
  const civilZenith = 96 * rad
  const hourAngle =
    Math.acos(Math.cos(civilZenith) / (Math.cos(lat) * Math.cos(decl)) - Math.tan(lat) * Math.tan(decl)) / rad
  const dawn = 720 - 4 * (HANOVER.lon + hourAngle) - eqTime
  const dusk = 720 - 4 * (HANOVER.lon - hourAngle) - eqTime
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes()
  // Hanover's dusk falls after midnight UTC, so the evening wraps past 1440.
  const afterMidnight = minutes + 1440
  const inDaylight = (m: number) => m >= dawn && m < dusk
  return !(inDaylight(minutes) || inDaylight(afterMidnight))
}
