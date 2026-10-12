/**
 * The seven tetrominoes, and the look of a single block.
 *
 * The block recipe is taken from the milestone art rather than invented: every block there is a
 * 221x221 cell drawn as a light bevel path, the same path turned 180 degrees in a darker shade,
 * a 159x159 face inset by 31, and a glyph centred on the face. Reusing the geometry is what makes
 * a game piece look like it came out of the same drawing as the board behind it.
 */

export const CELL = 221
/** The bevel, drawn once light and once rotated into shadow. */
export const BEVEL_PATH = 'M0 221V0H221L190 31H31V190L0 221Z'
export const FACE_INSET = 31
export const FACE_SIZE = 159

export type Glyph = 'circle' | 'flower' | 'sparkle'

export interface BlockLook {
  /** Top-left bevel. */ light: string
  /** Bottom-right bevel. */ dark: string
  /** The flat face. */ face: string
  /** The mark on the face. */ ink: string
  glyph: Glyph
}

/**
 * Five of these are lifted straight from the export; the violet and blue were mixed to match,
 * because seven pieces need seven colours and the drawing only ever used five.
 *
 * The glyphs follow the same split. Every colour that came from the drawing wears the mark it
 * wears there -- teal, yellow and red carry the flower, pink and green the dot -- so a game piece
 * and a block on the board behind it are the same object. The sparkle is the one mark that is not
 * in the export, so it goes to the two colours that are not either.
 */
export const EMPTY_LOOK: BlockLook = {
  light: '#252525',
  dark: '#010101',
  face: '#161616',
  ink: '#161616',
  glyph: 'circle',
}

export type PieceId = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L'

export const LOOKS: Record<PieceId, BlockLook> = {
  I: { light: '#AEEBE4', dark: '#6DCCC1', face: '#8CE0D6', ink: '#64B598', glyph: 'flower' },
  O: { light: '#FFF7D0', dark: '#FFEB84', face: '#FFF3B5', ink: '#24B1B1', glyph: 'flower' },
  T: { light: '#F1A8CF', dark: '#D97BAE', face: '#E68FBE', ink: '#CA60AC', glyph: 'circle' },
  S: { light: '#BDE6A4', dark: '#80B75E', face: '#A2D483', ink: '#092940', glyph: 'circle' },
  Z: { light: '#FF9C9C', dark: '#DC5151', face: '#F97979', ink: '#FFF3B5', glyph: 'flower' },
  J: { light: '#E0CCF5', dark: '#A277CC', face: '#C9A6E8', ink: '#5B2E8C', glyph: 'sparkle' },
  L: { light: '#C6DEF8', dark: '#6E9DD6', face: '#9EC4F0', ink: '#1E4E8C', glyph: 'sparkle' },
}

/**
 * Each piece as the cells it fills, listed per rotation. Spelling the four rotations out is longer
 * than rotating a matrix at runtime, but it is the only way the I and O pieces come out right:
 * both are famously not symmetric about their own bounding box, and every bug where a piece
 * wobbles as it spins traces back to rotating the box instead of the piece.
 */
export type Cells = ReadonlyArray<readonly [number, number]>

export const SHAPES: Record<PieceId, ReadonlyArray<Cells>> = {
  I: [
    [[0, 1], [1, 1], [2, 1], [3, 1]],
    [[2, 0], [2, 1], [2, 2], [2, 3]],
    [[0, 2], [1, 2], [2, 2], [3, 2]],
    [[1, 0], [1, 1], [1, 2], [1, 3]],
  ],
  O: [
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
  ],
  T: [
    [[1, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [1, 2]],
    [[1, 0], [0, 1], [1, 1], [1, 2]],
  ],
  S: [
    [[1, 0], [2, 0], [0, 1], [1, 1]],
    [[1, 0], [1, 1], [2, 1], [2, 2]],
    [[1, 1], [2, 1], [0, 2], [1, 2]],
    [[0, 0], [0, 1], [1, 1], [1, 2]],
  ],
  Z: [
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[2, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [1, 2], [2, 2]],
    [[1, 0], [0, 1], [1, 1], [0, 2]],
  ],
  J: [
    [[0, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [2, 2]],
    [[1, 0], [1, 1], [0, 2], [1, 2]],
  ],
  L: [
    [[2, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [1, 2], [2, 2]],
    [[0, 1], [1, 1], [2, 1], [0, 2]],
    [[0, 0], [1, 0], [1, 1], [1, 2]],
  ],
}

export const PIECE_IDS = Object.keys(SHAPES) as PieceId[]

/**
 * Kicks tried, in order, when a rotation lands in a wall or a stack. This is a trimmed version of
 * the usual wall-kick table: enough that spinning against a wall or into a one-cell notch works
 * the way players expect, without the full per-rotation-pair tables.
 */
export const KICKS: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1], [-1, -1], [1, -1],
]
