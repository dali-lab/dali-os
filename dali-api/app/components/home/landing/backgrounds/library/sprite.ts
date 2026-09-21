import type { CSSProperties } from 'react'
import type { FrameBox } from './art/librarySprites'

/**
 * Places a `.landing-sprite` element over a region of the 4075×1545 library frame. The CSS
 * maps frame units to pixels with the same cover scaling as the room image, so sprites stay
 * pinned to the art at any window size. Extra custom properties can be merged in.
 */
export function spriteStyle(box: FrameBox, extra: Record<string, string | number> = {}): CSSProperties {
  return { '--x': box.x, '--y': box.y, '--w': box.w, '--h': box.h, ...extra } as CSSProperties
}

/** An ellipse (centre and radii) as a frame box. */
export function ellipseBox(cx: number, cy: number, rx: number, ry: number): FrameBox {
  return { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 }
}
