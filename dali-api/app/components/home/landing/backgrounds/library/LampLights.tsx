import { LAMP_SPRITES } from './art/librarySprites'
import { ellipseBox, spriteStyle } from './sprite'

/**
 * The four table lamps. Each lamp is a set of GPU-composited sprites, so flickering them
 * only changes opacity and never repaints anything:
 *
 * - hover: a wide warm glow that fades up as the cursor nears (--near, set by script);
 * - halo: warm light screen-blended over the fuzzy halo traced into the room, flickering;
 * - glow and core: the export's blurred lamp light, pre-rendered once.
 *
 * `.landing-lamp` adds no stacking context, so the screen-blended layers blend with the room.
 */
export default function LampLights() {
  return LAMP_SPRITES.map((lamp) => {
    const { x, y, w, h } = lamp.shade
    return (
      <div key={lamp.id} className="landing-lamp" data-lamp={lamp.id}>
        <div
          className="landing-sprite landing-lamp-hover"
          style={spriteStyle(ellipseBox(x, y, w * 2.3, h * 2.1), { '--lamp-order': lamp.order })}
        />
        <div
          className="landing-sprite landing-lamp-halo"
          style={spriteStyle(ellipseBox(x, y, w * 1.45, h * 1.35), {
            '--lamp-order': lamp.order,
            '--flicker-delay': `${lamp.halo.delay}ms`,
            '--flicker-duration': `${lamp.halo.duration}ms`,
          })}
        />
        <div
          className="landing-sprite landing-lamp-glow"
          style={spriteStyle(lamp.glow.box, {
            '--lamp-order': lamp.order,
            '--flicker-delay': `${lamp.glow.delay}ms`,
            '--flicker-duration': `${lamp.glow.duration}ms`,
          })}
        >
          <lamp.glow.Art />
        </div>
        <div
          className="landing-sprite landing-lamp-core"
          style={spriteStyle(lamp.core.box, {
            '--lamp-order': lamp.order,
            '--flicker-delay': `${lamp.core.delay}ms`,
            '--flicker-duration': `${lamp.core.duration}ms`,
          })}
        >
          <lamp.core.Art />
        </div>
      </div>
    )
  })
}
