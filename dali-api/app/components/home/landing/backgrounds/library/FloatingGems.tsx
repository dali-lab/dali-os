import type { CSSProperties } from 'react'
import { GEM_SPRITES } from './art/librarySprites'
import { spriteStyle } from './sprite'

/**
 * The six floating gems, each a pre-rendered sprite. Layers per gem:
 *
 * - `.landing-gem-magnet`: leans toward the cursor and spins when clicked (script);
 * - `.landing-gem`: the CSS float (bob and sway) and load-in fade;
 * - `.landing-gem-pulse`: a soft glow in the gem's colour that swells and fades.
 *
 * Every animation is transform or opacity on its own composited element, so none of them
 * re-render the gem's blurred glow.
 */
export default function FloatingGems() {
  return GEM_SPRITES.map((gem) => (
    <div
      key={gem.id}
      className="landing-sprite landing-gem-magnet"
      data-gem={gem.id}
      style={spriteStyle(gem.box, { '--glow-color': gem.color })}
    >
      <div
        className="landing-gem"
        style={
          {
            '--gem-phase': `${gem.phase}ms`,
            '--gem-speed': gem.speed,
            '--gem-order': gem.order,
          } as CSSProperties
        }
      >
        <div className="landing-gem-pulse" />
        <gem.Art />
      </div>
    </div>
  ))
}
