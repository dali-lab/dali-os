/*
 * Where everything in the week 8 undergrowth sits, in the frame's own coordinate system.
 *
 * Split out of critters.tsx so that file exports only components -- the same arrangement week 0
 * uses for libraryGeometry.ts beside librarySprites.tsx, and the one React Fast Refresh needs.
 *
 * All coordinates are units of the 4076x1545 Figma frame, so a number here lands exactly where it
 * lands in the art. Scale reference, measured off the export: the ladybird is about 500 units
 * across including its legs, the centipede 450 long, the butterfly 650 wide.
 *
 * Anything that sits on a leaf names that leaf, because it has to move with it. The export
 * animates five leaves -- Group_6, Group_2, Group_4, Group_5 and Group_1, each of which is one
 * whole leaf -- and prep-week8-art.py derives a `w8-ride-<leaf>` animation for each, being the
 * motion that leaf performs in frame coordinates. Putting a thing inside a group carrying its
 * leaf's ride is what stops it sliding over the top of the art.
 */

/*
 * The ants' circuit, in frame units: a loop around the big left-hand leaf, Group_6.
 *
 * It begins and ends off the left edge of the frame, which is possible because that leaf is itself
 * cut off there -- its painted surface runs from x=0 out to x=636, and the leaf continues past the
 * frame boundary. So the column walks in from under the edge, works its way up the blade to the
 * tip, comes back down the other side and goes out again where it came in. Both ends being
 * off-screen is also what lets the animation loop without a fade: there is no visible moment where
 * an ant appears or vanishes.
 *
 * Every point of it was checked against the leaf's own rendered mask rather than eyeballed: of 201
 * samples along the curve, 169 lie on painted leaf and the other 32 are off the left of the frame.
 * None of it crosses bare background. Re-verify that after moving it.
 */
export const ANT_TRAIL =
  'M -180 800 C -40 786 130 744 300 658 C 420 608 522 572 596 546 ' +
  'C 584 588 520 628 430 688 C 330 754 230 822 150 898 C 80 964 30 1006 -180 1036'

/** The leaf the ant trail is drawn on, and therefore the leaf the column has to sway with. */
export const ANT_LEAF = 'Group_6'

export const ANT_COUNT = 7

/*
 * Where the spider's thread is tied: the lower edge of the ladybird's leaf.
 *
 * Measured off that leaf's mask -- at x=1140 the painted leaf runs from y=42 to y=476 -- so this
 * is its underside, and the spider drops from there into the open air below it. It rides the same
 * leaf, so when the leaf tips the anchor goes with it.
 */
export const SPIDER_ANCHOR = { leaf: 'Group_2', x: 1140, y: 476 }

/*
 * Dew, one drop per swaying leaf so that each one has a leaf to ride.
 *
 * The positions are not hand-picked: for each leaf, its rendered mask was eroded by 30 units and a
 * point taken from the upper part of what survived, so every drop sits well inside painted leaf
 * rather than on an edge, and on a surface that faces up. Dew on the underside of a leaf looks like
 * a mistake.
 */
export const DEW = [
  { id: 'a', leaf: 'Group_6', x: 411, y: 624, r: 9 },
  { id: 'b', leaf: 'Group_2', x: 922, y: 64, r: 7 },
  { id: 'c', leaf: 'Group_4', x: 1103, y: 1163, r: 8 },
  { id: 'd', leaf: 'Group_5', x: 1842, y: 83, r: 10 },
  { id: 'e', leaf: 'Group_1', x: 2142, y: 1132, r: 7 },
]

/*
 * Dappled light, seen from above.
 *
 * Not beams: the sun is overhead and what reaches a bed of leaves at midday is a scatter of bright
 * patches where the canopy has a gap and cool patches where it does not. So these are broad soft
 * blobs lying *on* the foliage, drifting slowly as though the canopy above were moving in the same
 * breeze that moves the leaves below.
 *
 * Light patches are screen-blended and can only brighten; shade patches are multiply-blended and
 * can only darken. The two together are what makes it read as light falling rather than as a wash
 * laid over the picture -- a brightness-only dapple flattens the scene instead of modelling it.
 *
 * Each is an ellipse rather than a circle, at its own angle, and neighbours overlap: the irregular
 * edge comes from the overlap, which is cheaper than drawing irregular shapes and does not need a
 * turbulence filter re-running every frame.
 *
 * Size is the thing that decides whether this reads as dapple or as haze. A first pass used eight
 * light blobs of rx 350-610 -- wider than the ladybird -- and at that scale a soft gradient is just
 * a glow: the scene went milky and the lower-left turned into a bright oval around the butterfly.
 * These are rx 150-320, roughly the size of a gap between leaves, and there are twenty-five of
 * them, which is what gives the frame a pattern of light rather than a wash of it.
 */
export interface Dapple {
  id: string
  x: number
  y: number
  rx: number
  ry: number
  angle: number
}

export const DAPPLE_LIGHT: Dapple[] = [
  { id: 'l1', x: 196, y: 352, rx: 240, ry: 158, angle: -18 },
  { id: 'l2', x: 452, y: 612, rx: 170, ry: 112, angle: 26 },
  { id: 'l3', x: 744, y: 228, rx: 206, ry: 130, angle: -7 },
  { id: 'l4', x: 876, y: 1046, rx: 254, ry: 162, angle: 15 },
  { id: 'l5', x: 1184, y: 540, rx: 150, ry: 104, angle: -30 },
  { id: 'l6', x: 1392, y: 1260, rx: 228, ry: 146, angle: 8 },
  { id: 'l7', x: 1618, y: 316, rx: 186, ry: 124, angle: -12 },
  { id: 'l8', x: 1946, y: 872, rx: 262, ry: 170, angle: 22 },
  { id: 'l9', x: 2248, y: 324, rx: 198, ry: 128, angle: -24 },
  { id: 'l10', x: 2432, y: 1204, rx: 174, ry: 116, angle: 11 },
  { id: 'l11', x: 2756, y: 708, rx: 244, ry: 156, angle: -9 },
  { id: 'l12', x: 3092, y: 232, rx: 210, ry: 136, angle: 19 },
  { id: 'l13', x: 3368, y: 1096, rx: 232, ry: 150, angle: -16 },
  { id: 'l14', x: 3752, y: 536, rx: 190, ry: 126, angle: 6 },
]

export const DAPPLE_SHADE: Dapple[] = [
  { id: 's1', x: 76, y: 912, rx: 300, ry: 200, angle: 12 },
  { id: 's2', x: 608, y: 1304, rx: 272, ry: 182, angle: -20 },
  { id: 's3', x: 1020, y: 700, rx: 318, ry: 206, angle: 7 },
  { id: 's4', x: 1486, y: 836, rx: 254, ry: 170, angle: -14 },
  { id: 's5', x: 1772, y: 164, rx: 288, ry: 186, angle: 23 },
  { id: 's6', x: 2124, y: 1304, rx: 266, ry: 176, angle: -5 },
  { id: 's7', x: 2548, y: 500, rx: 310, ry: 198, angle: 16 },
  { id: 's8', x: 2920, y: 1096, rx: 246, ry: 164, angle: -22 },
  { id: 's9', x: 3284, y: 584, rx: 296, ry: 192, angle: 9 },
  { id: 's10', x: 3596, y: 1240, rx: 258, ry: 172, angle: -11 },
  { id: 's11', x: 3920, y: 196, rx: 280, ry: 184, angle: 18 },
]

/** Pollen motes per depth band, nearest band first. */
export const POLLEN_BANDS = [
  { id: 'near', count: 9, radius: 7 },
  { id: 'mid', count: 13, radius: 4.6 },
  { id: 'far', count: 18, radius: 2.8 },
]

/*
 * A mote's resting place, spread by a cheap deterministic hash rather than Math.random so the
 * scene is identical on every render and in every screenshot -- which is what makes a before and
 * after diff mean anything.
 */
export function moteAt(band: number, index: number) {
  const h = Math.sin((band + 1) * 12.9898 + index * 78.233) * 43758.5453
  const g = Math.sin((band + 1) * 39.3468 + index * 11.135) * 24634.6345
  return {
    x: ((h - Math.floor(h)) * 4076) | 0,
    y: ((g - Math.floor(g)) * 1545) | 0,
  }
}
