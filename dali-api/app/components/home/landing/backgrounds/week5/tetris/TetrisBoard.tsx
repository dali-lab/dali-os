import { cellsOf, COLS, dropDistance, ROWS, type Game } from './engine'
import {
  BEVEL_PATH,
  CELL,
  EMPTY_LOOK,
  FACE_INSET,
  FACE_SIZE,
  LOOKS,
  PIECE_IDS,
  type BlockLook,
  type Glyph,
  type PieceId,
} from './pieces'

/**
 * The playfield.
 *
 * One <svg> for the whole board, with each block drawn once into <defs> and then referenced per
 * cell. A board is 200 cells and repaints on every gravity tick, so the blocks are defined once
 * and stamped rather than rebuilt: a <use> is a reference, not a copy of the four shapes a block
 * is made from.
 */
export default function TetrisBoard({ game }: { game: Game }) {
  const ghostY = game.piece ? game.piece.y + dropDistance(game) : 0

  return (
    <svg
      className="t-board"
      viewBox={`0 0 ${COLS * CELL} ${ROWS * CELL}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <defs>
        <Sprite id="t-empty" look={EMPTY_LOOK} hollow />
        {PIECE_IDS.map((id) => (
          <Sprite key={id} id={`t-${id}`} look={LOOKS[id]} />
        ))}
      </defs>

      {/* The well. Static, so it is stamped once and never touched again. */}
      {Array.from({ length: ROWS }, (_, y) =>
        Array.from({ length: COLS }, (_, x) => (
          <use key={`e${x},${y}`} href="#t-empty" x={x * CELL} y={y * CELL} />
        )),
      )}

      {/* Blocks that have landed. */}
      {game.board.map((row, y) =>
        row.map((cell, x) =>
          cell === null ? null : (
            <use key={`b${x},${y}`} href={`#t-${cell}`} x={x * CELL} y={y * CELL} />
          ),
        ),
      )}

      {/*
        Where the piece would land. Without it you are judging a column by eye down twenty rows,
        which is the difference between the game feeling precise and feeling approximate.
      */}
      {game.piece && ghostY > game.piece.y && (
        <g className="t-ghost">
          {cellsOf(game.piece.id, game.piece.rotation).map(([dx, dy]) => {
            const x = game.piece!.x + dx
            const y = ghostY + dy
            return y < 0 ? null : (
              <rect
                key={`g${dx},${dy}`}
                x={x * CELL + FACE_INSET}
                y={y * CELL + FACE_INSET}
                width={FACE_SIZE}
                height={FACE_SIZE}
                fill={LOOKS[game.piece!.id].face}
              />
            )
          })}
        </g>
      )}

      {/* The piece in hand. */}
      {game.piece &&
        cellsOf(game.piece.id, game.piece.rotation).map(([dx, dy]) => {
          const y = game.piece!.y + dy
          // The spawn rows sit above the board; a piece there is only half in the world yet.
          return y < 0 ? null : (
            <use
              key={`p${dx},${dy}`}
              href={`#t-${game.piece!.id}`}
              x={(game.piece!.x + dx) * CELL}
              y={y * CELL}
            />
          )
        })}
    </svg>
  )
}

/**
 * One block, built the way the milestone art builds its blocks: a light bevel, the same shape
 * turned 180 degrees in shadow, a face inset inside them, and a mark on the face.
 */
function Sprite({ id, look, hollow }: { id: string; look: BlockLook; hollow?: boolean }) {
  const centre = FACE_INSET + FACE_SIZE / 2
  return (
    <g id={id}>
      <path d={BEVEL_PATH} fill={look.light} />
      <path d={BEVEL_PATH} transform={`matrix(-1 0 0 -1 ${CELL} ${CELL})`} fill={look.dark} />
      <rect x={FACE_INSET} y={FACE_INSET} width={FACE_SIZE} height={FACE_SIZE} fill={look.face} />
      {!hollow && <Mark glyph={look.glyph} cx={centre} cy={centre} fill={look.ink} hole={look.face} />}
    </g>
  )
}

/** Picks the mark a block wears. */
function Mark({
  glyph,
  cx,
  cy,
  fill,
  hole,
}: {
  glyph: Glyph
  cx: number
  cy: number
  fill: string
  hole: string
}) {
  switch (glyph) {
    case 'circle':
      return <circle cx={cx} cy={cy} r={39.75} fill={fill} />
    case 'sparkle':
      return <Sparkle cx={cx} cy={cy} fill={fill} />
    case 'flower':
      return <Flower cx={cx} cy={cy} fill={fill} hole={hole} />
  }
}

/**
 * A four-pointed sparkle, on the axes rather than the diagonals and with its sides drawn inward,
 * so it reads as a glint beside the flower's fat diagonal lobes rather than as a second version
 * of the same mark. Unlike the other two this one is not in the export -- it is worn only by the
 * violet and blue pieces, the two colours that were mixed rather than lifted.
 */
function Sparkle({ cx, cy, fill }: { cx: number; cy: number; fill: string }) {
  const REACH = 50   // tip, measured from the middle
  const WAIST = 13   // how far the sides bow back in between the tips
  const PULL = WAIST * 1.6
  return (
    <path
      fill={fill}
      d={`M ${cx} ${cy - REACH}
          C ${cx + WAIST} ${cy - PULL} ${cx + PULL} ${cy - WAIST} ${cx + REACH} ${cy}
          C ${cx + PULL} ${cy + WAIST} ${cx + WAIST} ${cy + PULL} ${cx} ${cy + REACH}
          C ${cx - WAIST} ${cy + PULL} ${cx - PULL} ${cy + WAIST} ${cx - REACH} ${cy}
          C ${cx - PULL} ${cy - WAIST} ${cx - WAIST} ${cy - PULL} ${cx} ${cy - REACH} Z`}
    />
  )
}

/**
 * The four-petal mark the art uses on its teal, yellow and red blocks.
 *
 * Measured off the export rather than guessed: four fat lobes on the diagonals, not on the axes,
 * and a hole punched through the middle in the face colour. The hole is the part that is easy to
 * miss and the part that makes it read as the same mark -- without it the glyph is a blob.
 *
 * The original is a masked group several layers deep. This is the same shape drawn as four
 * ellipses and a circle, which costs five elements instead of a mask and a clip per block.
 */
function Flower({ cx, cy, fill, hole }: { cx: number; cy: number; fill: string; hole: string }) {
  const REACH = 27   // how far each lobe's centre sits from the middle
  const LONG = 27    // lobe half-length, outward
  const WIDE = 17    // lobe half-width, across
  const HOLE = 13
  return (
    <g>
      {[45, 135, 225, 315].map((angle) => (
        <ellipse
          key={angle}
          cx={cx + REACH}
          cy={cy}
          rx={LONG}
          ry={WIDE}
          fill={fill}
          transform={`rotate(${angle} ${cx} ${cy})`}
        />
      ))}
      <circle cx={cx} cy={cy} r={HOLE} fill={hole} />
    </g>
  )
}

/** The three pieces queued up, drawn small. */
export function NextQueue({ next }: { next: PieceId[] }) {
  return (
    <div className="t-next">
      {next.map((id, i) => (
        <svg key={`${id}-${i}`} className="t-next-piece" viewBox={`0 0 ${4 * CELL} ${2 * CELL}`}>
          <defs>
            <Sprite id={`t-next-${id}-${i}`} look={LOOKS[id]} />
          </defs>
          {cellsOf(id, 0).map(([dx, dy]) => (
            <use key={`${dx},${dy}`} href={`#t-next-${id}-${i}`} x={dx * CELL} y={dy * CELL} />
          ))}
        </svg>
      ))}
    </div>
  )
}
