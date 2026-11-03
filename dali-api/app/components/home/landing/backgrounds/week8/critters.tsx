/*
 * The two creatures added to the week 8 scene, drawn to match the export.
 *
 * Each is drawn around its own origin in the frame's coordinate system -- a 4076x1545 box, the same
 * one the Figma export uses -- and placed by critterPlaces.ts, which holds the ant trail and the
 * spider's anchor. The overlay <svg> in Undergrowth.tsx carries the matching viewBox and
 * preserveAspectRatio and week8.css sizes it with the same rule as the foliage, so the two register
 * pixel for pixel.
 *
 * Scale reference, measured off the export: the ladybird is about 500 units across including its
 * legs, the centipede 450 long, the butterfly 650 wide. Both of these are sized against those,
 * which is why an ant is 70 units and not 7.
 *
 * There were five more -- a caterpillar, a snail, a beetle, a dragonfly and four bugs hidden in the
 * leaves for a cursor hunt. They were cut because they travelled over the top of the art instead of
 * belonging to it: a creature in this scene has to be sitting on a particular leaf and moving with
 * it, and anything crossing several leaves at once cannot be. The ants earn their place by
 * circling one leaf; the spider by hanging off the edge of another.
 *
 * Palette is taken from the export's own fills rather than invented: the greens run #102D1D to
 * #77A46B and the shadow between back leaves is #0A2018.
 */

const CHITIN = '#1A1410'
const CHITIN_LIT = '#3A2E22'

/* ---------- Ants ---------- */

/*
 * One ant, nose pointing along +x so `offset-rotate: auto` can steer it down the trail.
 *
 * Three body segments, six legs and two antennae, which is the minimum that still reads as an ant
 * rather than as a dash. The legs are strokes rather than shapes because at 70 units across a
 * filled leg would be a single pixel wide on a phone.
 */
export function Ant() {
  return (
    /*
     * Shifted onto its own centre. offset-path moves an element's origin along the path, so an ant
     * drawn from x=2 to x=70 would ride the trail with its tail on the line and its head 36 units
     * off it.
     */
    <g className="w8-ant" transform="translate(-36 -3)">
      <g className="w8-ant-legs" stroke={CHITIN} strokeWidth="3.2" strokeLinecap="round" fill="none">
        <path d="M22 4 L10 -12 M22 4 L2 -6 M22 6 L8 20" />
        <path d="M40 4 L40 -16 M40 5 L46 -8 M40 6 L38 22" />
      </g>
      <ellipse className="w8-ant-gaster" cx="14" cy="4" rx="15" ry="11" fill={CHITIN} />
      <ellipse cx="34" cy="4" rx="8" ry="7" fill={CHITIN_LIT} />
      <ellipse cx="50" cy="3" rx="10" ry="9" fill={CHITIN} />
      <path
        d="M57 -2 L68 -14 M58 2 L70 -4"
        stroke={CHITIN}
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
      {/* A single lit facet, so the body is not a silhouette in full daylight. */}
      <ellipse cx="11" cy="0" rx="7" ry="4" fill={CHITIN_LIT} opacity="0.8" />
    </g>
  )
}

/* ---------- Spider ---------- */

/*
 * Hangs nose-down from its own origin. The thread is not drawn here -- Undergrowth.tsx draws it at
 * the anchor on the leaf, so it can be stretched to match the descent rather than travelling with
 * the spider.
 */
export function Spider() {
  return (
    <g className="w8-spider">
      <g className="w8-spider-legs" stroke="#241C16" strokeWidth="3" strokeLinecap="round" fill="none">
        <path d="M-6 10C-26 2 -36 12 -44 30 M-6 16C-30 14 -42 26 -46 46" />
        <path d="M-5 22C-24 26 -32 40 -34 58 M-4 27C-18 36 -22 50 -20 66" />
        <path d="M6 10C26 2 36 12 44 30 M6 16C30 14 42 26 46 46" />
        <path d="M5 22C24 26 32 40 34 58 M4 27C18 36 22 50 20 66" />
      </g>
      <ellipse cx="0" cy="14" rx="9" ry="8" fill="#2A211A" />
      <ellipse cx="0" cy="34" rx="15" ry="17" fill="#1C1511" />
      {/* The pale saddle most garden spiders carry, so it is not a black blob. */}
      <path d="M-7 28C-3 24 3 24 7 28C4 36 -4 36 -7 28Z" fill="#8A7A5C" opacity="0.75" />
    </g>
  )
}
