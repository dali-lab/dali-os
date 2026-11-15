import { circle, lerp, TAU } from './paint'

/*
 * The poster's runner, seen from behind: navy hoodie with the hood down, a cloud of purple curls,
 * a ribbed waistband that reads as film perforations, ink outlines and a volt rim light from the
 * core ahead. Drawn twice: once offset in volt for the rim, then the figure itself on top.
 *
 * Coordinates are in units of `s`, the figure's height, with the feet at the origin.
 */

const INK = '#0b0720'
const NAVY = '#1d1746'
const NAVY_LIT = '#3a2a7c'
const PURPLE = '#33206a'
const PURPLE_LIT = '#5f3aa8'
const HAIR = '#33226f'
const HAIR_LIT = '#6e4fc0'
const RIM = 'rgba(242,245,61,0.95)'

type UV = [number, number]

const TORSO: UV[] = [
  [-0.17, -0.83], [-0.06, -0.87], [0.06, -0.87], [0.17, -0.83], [0.185, -0.72], [0.14, -0.58],
  [0.145, -0.47], [0, -0.45], [-0.145, -0.47], [-0.14, -0.58], [-0.185, -0.72],
]
const HOOD: UV[] = [[-0.11, -0.88], [0.11, -0.88], [0.1, -0.79], [0.03, -0.73], [-0.03, -0.73], [-0.1, -0.79]]
const CURLS: [number, number, number][] = [
  [0, -0.98, 0.12],
  ...Array.from({ length: 15 }, (_, k): [number, number, number] => {
    const a = Math.PI * (0.78 + k * 0.103)
    return [Math.cos(a) * 0.135, -0.98 + Math.sin(a) * 0.12, 0.048 + ((k * 7) % 3) * 0.009]
  }),
]

export function drawRunner(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  stride: number,
  airborne: boolean,
  lean: number,
  alpha: number,
) {
  if (alpha <= 0) return
  g.save()
  g.globalAlpha = alpha
  g.translate(x, y)
  g.rotate(lean)

  g.globalCompositeOperation = 'lighter'
  const glow = g.createRadialGradient(0, 0, 0, 0, 0, s * 0.55)
  glow.addColorStop(0, `rgba(242,245,61,${airborne ? 0.12 : 0.5})`)
  glow.addColorStop(1, 'rgba(242,245,61,0)')
  g.fillStyle = glow
  g.beginPath()
  g.ellipse(0, 0, s * 0.55, s * 0.17, 0, 0, TAU)
  g.fill()
  g.globalCompositeOperation = 'source-over'

  const sw = Math.sin(stride)
  const bob = airborne ? 0 : -Math.abs(Math.cos(stride)) * s * 0.025
  const ow = Math.max(1, s * 0.016)
  const at = (u: number, v: number): UV => [u * s, v * s]

  const smoothPath = (pts: UV[]) => {
    const q = pts.map(([u, v]) => at(u, v))
    const n = q.length
    const mid = (a: UV, b: UV): UV => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    g.beginPath()
    const m = mid(q[n - 1], q[0])
    g.moveTo(m[0], m[1])
    for (let i = 0; i < n; i++) {
      const next = mid(q[i], q[(i + 1) % n])
      g.quadraticCurveTo(q[i][0], q[i][1], next[0], next[1])
    }
    g.closePath()
  }
  const stroke = (pts: UV[], w: number) => {
    g.lineWidth = w * s
    g.beginPath()
    pts.forEach(([u, v], i) => (i ? g.lineTo(u * s, v * s) : g.moveTo(u * s, v * s)))
    g.stroke()
  }
  const legPose = (side: number) => {
    const k = airborne ? 0.55 : Math.pow(Math.max(0, side * sw), 0.6)
    return {
      k,
      hip: [side * 0.07, -0.47] as UV,
      knee: [side * lerp(0.11, 0.06, k), lerp(-0.23, -0.19, k)] as UV,
      foot: [side * lerp(0.1, 0.035, k), lerp(0.01, -0.37, k)] as UV,
    }
  }

  const figure = (rim: string | null) => {
    const paint = (c: string) => rim ?? c
    g.lineCap = 'round'
    g.lineJoin = 'round'

    const limb = (pts: UV[], w: number, base: string, lit: string, litDx: number) => {
      g.strokeStyle = paint(INK)
      stroke(pts, w + (ow * 2) / s)
      g.strokeStyle = paint(base)
      stroke(pts, w)
      if (rim) return
      g.save()
      g.translate(litDx * s, 0)
      g.strokeStyle = lit
      stroke(pts, w * 0.26)
      g.restore()
    }
    const shoe = (foot: UV, k: number) => {
      const [fx, fy] = at(foot[0], foot[1])
      const rx = s * lerp(0.048, 0.058, k)
      const ry = s * lerp(0.03, 0.062, k)
      g.fillStyle = paint(INK)
      g.beginPath()
      g.ellipse(fx, fy, rx + ow, ry + ow, 0, 0, TAU)
      g.fill()
      if (rim) return
      g.fillStyle = k > 0.3 ? '#4b3489' : '#271a55'
      g.beginPath()
      g.ellipse(fx, fy, rx, ry, 0, 0, TAU)
      g.fill()
      // The glowing edge of the sole: the heel of a kicked-back foot, the tread of a planted one.
      g.fillStyle = 'rgba(242,245,61,0.85)'
      g.beginPath()
      if (k > 0.3) g.ellipse(fx, fy - ry * 0.55, rx * 0.7, ry * 0.25, 0, 0, TAU)
      else g.ellipse(fx, fy + ry * 0.55, rx * 0.8, ry * 0.32, 0, 0, TAU)
      g.fill()
    }

    // The kicked-back leg is nearest the camera, so it is drawn last.
    for (const leg of [legPose(-1), legPose(1)].sort((a, b) => a.k - b.k)) {
      limb([leg.hip, leg.knee], 0.12, PURPLE, PURPLE_LIT, -0.02)
      limb([leg.knee, leg.foot], 0.085, PURPLE, PURPLE_LIT, -0.015)
      shoe(leg.foot, leg.k)
    }

    g.save()
    g.translate(sw * s * 0.012, bob)
    g.rotate(sw * 0.035)

    for (const side of [-1, 1]) {
      const swing = airborne ? 0.4 : -side * sw
      const shoulder: UV = [side * 0.15, -0.79]
      const elbow: UV = [side * (0.25 + 0.02 * swing), -0.66 - 0.05 * swing]
      const hand: UV = [side * (0.2 - 0.04 * swing), lerp(-0.5, -0.66, (swing + 1) / 2)]
      limb([shoulder, elbow, hand], 0.095, NAVY, NAVY_LIT, side * 0.012)
      const [hx, hy] = at(hand[0], hand[1])
      g.fillStyle = paint(INK)
      circle(g, hx, hy, s * 0.042 + ow)
      if (!rim) {
        g.fillStyle = '#2c1d5e'
        circle(g, hx, hy, s * 0.042)
        g.fillStyle = INK
        const [wx, wy] = at(lerp(elbow[0], hand[0], 0.78), lerp(elbow[1], hand[1], 0.78))
        circle(g, wx, wy, s * 0.04)
      }
    }

    g.lineWidth = ow * 2
    g.strokeStyle = paint(INK)
    smoothPath(TORSO)
    g.stroke()
    g.fillStyle = paint(NAVY)
    smoothPath(TORSO)
    g.fill()
    if (!rim) {
      g.save()
      smoothPath(TORSO)
      g.clip()
      g.fillStyle = NAVY_LIT
      g.beginPath()
      g.ellipse(s * 0.09, -s * 0.7, s * 0.07, s * 0.13, -0.2, 0, TAU)
      g.fill()
      g.beginPath()
      g.ellipse(-s * 0.13, -s * 0.66, s * 0.035, s * 0.1, 0.15, 0, TAU)
      g.fill()
      g.strokeStyle = 'rgba(11,7,32,0.6)'
      g.lineWidth = ow
      g.beginPath()
      g.moveTo(-s * 0.02, -s * 0.74)
      g.quadraticCurveTo(s * 0.01, -s * 0.62, -s * 0.01, -s * 0.52)
      g.stroke()
      g.restore()

      const wy = -s * 0.505
      const wh = s * 0.05
      const wx = -s * 0.145
      const ww = s * 0.29
      g.fillStyle = INK
      g.fillRect(wx - ow, wy - ow, ww + ow * 2, wh + ow * 2)
      g.fillStyle = '#17112e'
      g.fillRect(wx, wy, ww, wh)
      if (s > 40) {
        g.fillStyle = 'rgba(176,170,210,0.55)'
        for (let k = 0; k < 11; k++) g.fillRect(wx + ww * ((k + 0.35) / 11), wy + wh * 0.22, Math.max(1, ww * 0.03), wh * 0.56)
      }

      g.lineWidth = ow * 2
      g.strokeStyle = INK
      smoothPath(HOOD)
      g.stroke()
      g.fillStyle = '#2e2168'
      smoothPath(HOOD)
      g.fill()
      g.fillStyle = NAVY_LIT
      g.beginPath()
      g.ellipse(s * 0.05, -s * 0.82, s * 0.035, s * 0.04, 0, 0, TAU)
      g.fill()

      g.fillStyle = INK
      for (const [u, v, r] of CURLS) circle(g, u * s, v * s, r * s + ow)
    }
    g.fillStyle = paint(HAIR)
    for (const [u, v, r] of CURLS) circle(g, u * s, v * s, r * s)
    if (!rim) {
      g.strokeStyle = HAIR_LIT
      g.lineWidth = Math.max(1, s * 0.014)
      for (const [u, v, r] of CURLS.slice(1)) {
        if (u < -0.02 || v > -0.95) continue
        g.beginPath()
        g.arc(u * s, v * s, r * s * 0.6, -1.9, -0.5)
        g.stroke()
      }
      g.fillStyle = 'rgba(122,88,208,0.35)'
      g.beginPath()
      g.ellipse(s * 0.05, -s * 1.03, s * 0.08, s * 0.06, 0.4, 0, TAU)
      g.fill()
    }
    g.restore()
  }

  g.save()
  g.translate(s * 0.022, -s * 0.014)
  figure(RIM)
  g.restore()
  figure(null)
  g.restore()
}
