export const TAU = Math.PI * 2

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

export function seededRandom(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rgbCache = new Map<string, [number, number, number]>()
function rgb(hex: string) {
  let c = rgbCache.get(hex)
  if (!c) {
    const n = parseInt(hex.slice(1), 16)
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    rgbCache.set(hex, c)
  }
  return c
}

export function mix(a: string, b: string, t: number) {
  const A = rgb(a)
  const B = rgb(b)
  return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`
}

export type Point = { x: number; y: number }

export function catmull(pts: Point[], seg: number): Point[] {
  const out: Point[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? pts[i + 1]
    for (let j = 0; j < seg; j++) {
      const t = j / seg
      const t2 = t * t
      const t3 = t2 * t
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      })
    }
  }
  out.push({ ...pts[pts.length - 1] })
  return out
}

export function circle(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath()
  g.arc(x, y, r, 0, TAU)
  g.fill()
}

/** The poster's four-point star at the heart of the light, with a thin prism fringe. */
export function sparkle(g: CanvasRenderingContext2D, x: number, y: number, R: number, rot: number, alpha = 1) {
  const path = (r: number) => {
    g.beginPath()
    for (let k = 0; k < 4; k++) {
      const a = rot + (k * Math.PI) / 2
      const b = a + Math.PI / 4
      const tx = x + Math.cos(a) * r
      const ty = y + Math.sin(a) * r
      if (k === 0) g.moveTo(tx, ty)
      else g.lineTo(tx, ty)
      g.quadraticCurveTo(
        x + Math.cos(b) * r * 0.1,
        y + Math.sin(b) * r * 0.1,
        x + Math.cos(a + Math.PI / 2) * r,
        y + Math.sin(a + Math.PI / 2) * r,
      )
    }
    g.closePath()
  }
  g.save()
  g.globalCompositeOperation = 'lighter'
  g.lineWidth = Math.max(1, R * 0.05)
  g.globalAlpha = alpha * 0.8
  g.translate(-R * 0.04, 0)
  g.strokeStyle = 'rgba(255,110,210,1)'
  path(R)
  g.stroke()
  g.translate(R * 0.08, 0)
  g.strokeStyle = 'rgba(100,230,255,1)'
  path(R)
  g.stroke()
  g.translate(-R * 0.04, 0)
  g.globalAlpha = alpha
  g.fillStyle = '#fffff6'
  path(R)
  g.fill()
  g.globalAlpha = alpha * 0.7
  g.save()
  g.translate(x, y)
  g.rotate(Math.PI / 4)
  g.translate(-x, -y)
  path(R * 0.5)
  g.fill()
  g.restore()
  g.restore()
}
