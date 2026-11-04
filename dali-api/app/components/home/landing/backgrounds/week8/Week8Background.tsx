import type { AnimationEvent, MouseEvent } from 'react'
import { useState } from 'react'
import foliageMarkup from '~/assets/landing/week8/foliage.svg?raw'
import Undergrowth from './Undergrowth'
import './week8.css'

/**
 * Full-bleed background for the week 8 milestone: the bug hunt, drawn as a wall of foliage with
 * three insects in it, from the Figma export "Week_8_Milestone" (4077x1545).
 *
 * Two layers, both inside .w8-scene so the frosted glass over the copy frosts the lot: the export
 * itself, inlined, and Undergrowth on top of it -- the overhead dapple, pollen, dew, an ant column,
 * a spider, and the export's own butterfly, lifted out of it so it sits above the ants.
 *
 * The export's own animation is one 5.3s loop across 51 keyframe tracks: nine leaves swaying, the
 * butterfly's wings, the ladybird's shell and the centipede's legs. Figma writes it as a <style>
 * block inside the SVG, so the art has to be inlined rather than loaded as an <img> -- an SVG
 * referenced by <img> is rendered in its own context with scripting and external state shut out
 * and its stylesheet never runs, which would leave the scene frozen on its first frame.
 *
 * That loop arrived choppy, and the cause was in the data rather than in the rendering: every one
 * of the 51 tracks was frozen from its penultimate keyframe to 100%, and 32 of them had stopped
 * moving by 42% of the cycle. The scene moved for two seconds and then held a still frame for
 * three and a third, in unison, forever. prep-week8-art.py's retime() rescales each track so its
 * gesture fills the cycle, and week8.css then puts each creature on its own clock so they no
 * longer restart together.
 *
 * The prep script has also cut the export's drawn copy panel -- the grey card over the right half
 * and the "08 / Bug Hunt / Week 1 - Sep 15 – 19" lettering on it, whose dates were the template's
 * placeholders -- split the butterfly's drop shadow off into a static pass so it is not blurred
 * afresh on every frame, and derived a "ride" animation for each animated leaf so that the
 * ladybird and the centipede sway with the leaf they are sitting on instead of over the top of it.
 *
 * The butterfly is the one thing that answers a click: it flies off the top-left of the frame and
 * comes back to land where it was. The markup is static HTML, so React only flags the scene and
 * week8.css runs the flight; the flag clears when the flight's own animation ends.
 */
export default function Week8Background() {
  const [flying, setFlying] = useState(false)

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest('.w8-butterfly')) setFlying(true)
  }
  const handleAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.animationName === 'w8-flight') setFlying(false)
  }

  return (
    <div className="landing-background landing-week8 landing-animated">
      <div
        className="w8-scene"
        aria-hidden="true"
        data-butterfly={flying ? 'away' : undefined}
        onClick={handleClick}
        onAnimationEnd={handleAnimationEnd}
      >
        <div
          className="w8-foliage"
          // The markup is a build-time import of a file in this repo, not anything user-supplied.
          dangerouslySetInnerHTML={{ __html: foliageMarkup }}
        />
        <Undergrowth />
      </div>
      <div className="landing-scrim" />
    </div>
  )
}
