import Glows from './art/Glows'
import Moon from './art/Moon'
import Nebula from './art/Nebula'
import Rocket from './art/Rocket'
import Sky from './art/Sky'
import Smoke from './art/Smoke'
import Sparkles from './art/Sparkles'

/** Full-bleed animated sky. Anchored bottom-left so it lines up with the stage on wide screens. */
export function LandingSky() {
  return <Sky className="landing-sky landing-animated" preserveAspectRatio="xMinYMax slice" />
}

/**
 * Moon, glows, sparkles, rocket and smoke, stacked in the export's paint order. Every layer
 * shares the Figma frame's coordinate space, so the stage only has to scale as one unit.
 */
export function LandingStage() {
  return (
    <div className="landing-stage landing-animated">
      <Nebula className="landing-layer landing-enter-fade" />
      <Moon className="landing-layer" />
      <Glows className="landing-layer landing-enter-fade" />
      <Sparkles className="landing-layer" />
      <Rocket className="landing-layer landing-enter-rocket" />
      <Smoke className="landing-layer" />
    </div>
  )
}
