import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Undergrowth from '../Undergrowth'
import { ANT_COUNT, ANT_LEAF, ANT_TRAIL, DEW, moteAt, SPIDER_ANCHOR } from '../critterPlaces'

const here = path.dirname(new URL(import.meta.url).pathname)
const foliage = readFileSync(path.resolve(here, '../../../../../../assets/landing/week8/foliage.svg'), 'utf8')
const week8Css = readFileSync(path.resolve(here, '../week8.css'), 'utf8')
const landingCss = readFileSync(path.resolve(here, '../../../landing.css'), 'utf8')
const overlay = renderToStaticMarkup(<Undergrowth />)

const rootAttr = (markup: string, name: string) => markup.match(new RegExp(`^<svg[^>]*\\s${name}="([^"]+)"`))?.[1]
const rideLeaves = [...new Set([ANT_LEAF, SPIDER_ANCHOR.leaf, ...DEW.map((d) => d.leaf)])]

describe('week 8 overlay registration', () => {
  it('uses the foliage export’s viewBox and preserveAspectRatio verbatim', () => {
    expect(rootAttr(foliage, 'viewBox')).toBe('0 0 4076 1545')
    expect(rootAttr(overlay, 'viewBox')).toBe(rootAttr(foliage, 'viewBox'))
    expect(rootAttr(overlay, 'preserveAspectRatio')).toBe('xMinYMid slice')
    expect(rootAttr(overlay, 'preserveAspectRatio')).toBe(rootAttr(foliage, 'preserveAspectRatio'))
  })
})

describe('week 8 leaf rides', () => {
  it('has a derived ride keyframe set in the export for every leaf something sits on', () => {
    for (const leaf of rideLeaves) {
      expect(foliage).toContain(`@keyframes w8-ride-${leaf}`)
      expect(week8Css).toMatch(new RegExp(`\\.w8-ride-${leaf} \\{ animation-name: w8-ride-${leaf};`))
    }
  })

  it('never puts a ride on an element that carries a transform attribute', () => {
    const rides = [...overlay.matchAll(/<g[^>]*class="w8-ride [^"]*"[^>]*>/g)].map((m) => m[0])
    expect(rides).toHaveLength(DEW.length + 2)
    for (const tag of rides) expect(tag).not.toMatch(/\stransform=/)

    const foliageRides = [...foliage.matchAll(/<g[^>]*class="w8-ride [^"]*"[^>]*>/g)].map((m) => m[0])
    expect(foliageRides.length).toBeGreaterThan(0)
    for (const tag of foliageRides) expect(tag).not.toMatch(/\stransform=/)
  })

  it('pivots rides at 0 0, since the pivot is baked into the keyframes', () => {
    expect(week8Css).toMatch(/\.w8-ride \{\s*transform-origin: 0 0;/)
  })

  it('drives a leaf and its riders from the same duration and delay tokens', () => {
    for (const leaf of ['Group_6', 'Group_2', 'Group_4', 'Group_5', 'Group_1']) {
      const n = leaf.split('_')[1]
      expect(week8Css).toContain(`.w8-scene #${leaf} { animation-delay: var(--w8-gust-${n}); }`)
      expect(week8Css).toContain(`.w8-ride-${leaf} { animation-name: w8-ride-${leaf}; animation-delay: var(--w8-gust-${n}); }`)
    }
  })
})

describe('week 8 ant column', () => {
  it('starts and ends the trail off the left edge of the frame', () => {
    const xs = [...ANT_TRAIL.matchAll(/(-?\d+) (-?\d+)/g)].map((m) => Number(m[1]))
    expect(xs[0]).toBeLessThan(0)
    expect(xs[xs.length - 1]).toBeLessThan(0)
  })

  it('spaces the ants evenly along the loop', () => {
    const delays = [...overlay.matchAll(/animation-delay:(-?[\d.]+)s/g)].map((m) => Number(m[1]))
    expect(delays).toHaveLength(ANT_COUNT)
    for (let i = 0; i < ANT_COUNT; i++) expect(delays[i]).toBeCloseTo((-i * 13.6) / ANT_COUNT, 2)
  })

  it('parks every ant on screen under reduced motion', () => {
    const reduced = week8Css.slice(week8Css.indexOf('@media (prefers-reduced-motion: reduce)'))
    for (let i = 1; i <= ANT_COUNT; i++) {
      expect(reduced).toMatch(new RegExp(`\\.w8-ant-walker:nth-child\\(${i}\\) \\{ offset-distance: \\d+%; \\}`))
    }
    expect(reduced).toMatch(/\.w8-spider-drop \{ translate: 0 (\d+)px; \}/)
    expect(reduced).toMatch(/\.w8-spider-thread \{ scale: 1 (\d+); \}/)
    const drop = reduced.match(/\.w8-spider-drop \{ translate: 0 (\d+)px; \}/)?.[1]
    const thread = reduced.match(/\.w8-spider-thread \{ scale: 1 (\d+); \}/)?.[1]
    expect(thread).toBe(drop)
  })
})

describe('week 8 framing', () => {
  it('switches the pane at the same breakpoint that moves the copy into a column', () => {
    const desktop = '@container landing (min-width: 900px) and (min-aspect-ratio: 11/10)'
    expect(landingCss).toContain(desktop)
    expect(week8Css).toContain(desktop)
    expect(week8Css).not.toMatch(/@media \(min-width/)
  })

  it('ties the desktop pane to the copy column rather than a fixed percentage', () => {
    expect(week8Css).toContain('calc(100% - var(--pad) - var(--content-w) - var(--w8-pane-gutter))')
  })

  it('pins the narrow slice against the scene’s own height', () => {
    expect(week8Css).toContain('--w8-shift: max(0px, 138.19cqh - 100cqw);')
  })
})

describe('week 8 pollen', () => {
  it('places motes deterministically inside the frame', () => {
    for (let band = 0; band < 3; band++) {
      for (let i = 0; i < 20; i++) {
        const at = moteAt(band, i)
        expect(moteAt(band, i)).toEqual(at)
        expect(at.x).toBeGreaterThanOrEqual(0)
        expect(at.x).toBeLessThan(4076)
        expect(at.y).toBeGreaterThanOrEqual(0)
        expect(at.y).toBeLessThan(1545)
      }
    }
  })
})

describe('week 8 butterfly', () => {
  it('is drawn above the ants and spider and below the pollen', () => {
    const at = (needle: string) => overlay.indexOf(needle)
    expect(at('<g class="w8-butterfly">')).toBeGreaterThan(at('w8-ant-walker'))
    expect(at('<g class="w8-butterfly">')).toBeGreaterThan(at('w8-spider-drop'))
    expect(at('<g class="w8-butterfly">')).toBeLessThan(at('class="w8-pollen"'))
  })

  it('is lifted out of the export, leaving its shadow on the leaf', () => {
    expect(foliage).not.toContain('class="w8-butterfly"')
    expect(foliage).not.toContain('id="Group"')
    expect(foliage).toContain('class="w8-butterfly-shadow"')
    expect(overlay).toContain('id="Group"')
  })

  it('moves a transform-free wrapper, not #Group itself', () => {
    const wrapper = overlay.match(/<g class="w8-butterfly">(<g id="Group"[^>]*>)/)
    expect(wrapper).not.toBeNull()
    expect(wrapper?.[1]).toMatch(/\stransform=/)
    expect(week8Css).toMatch(/\[data-butterfly='away'\] \.w8-butterfly \{\s*animation: w8-flight /)
  })

  it('lands exactly where it took off', () => {
    const flight = week8Css.match(/@keyframes w8-flight \{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(flight).toMatch(/0% \{ transform: none; \}/)
    expect(flight).toMatch(/100% \{ transform: none; \}/)
  })

  it('is only a target when motion is allowed', () => {
    const block = week8Css.match(/@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(block).toMatch(/\.w8-butterfly \{\s*pointer-events: auto;/)
  })
})
