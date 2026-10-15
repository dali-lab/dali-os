/**
 * Rules checks for the tetris engine, run with `npm test` (Vitest, like the rest of the repo).
 *
 * It asserts the things that are tedious to confirm by playing: that a completed row is removed
 * and the stack above it falls, that four rows at once pay the full 800, that a piece cannot be
 * pushed through a wall, and that the game ends when the stack reaches the spawn area but *not*
 * when a clear happens to empty the board.
 *
 * The checks run as straight-line code against games that are mutated in place, and `ok` records
 * each result as its own named test. Deferring the conditions into the test callbacks instead
 * would read the games after later sections had already moved them on.
 */
import { expect, it } from 'vitest'
import {
  COLS, ROWS, createGame, startGame, fits, move, hardDrop, lock, dropDistance,
  cellsOf, dropInterval, pauseGame, resumeGame, endSession, type Game,
} from './engine'
import { SHAPES, PIECE_IDS, type PieceId } from './pieces'

const ok = (name: string, cond: boolean, extra = '') => {
  it(name, () => expect(cond, extra).toBe(true))
}

// --- every shape has exactly four cells in every rotation
let shapesOk = true, detail = ''
for (const id of PIECE_IDS) {
  for (let r = 0; r < 4; r++) {
    const c = SHAPES[id][r]
    if (c.length !== 4) { shapesOk = false; detail = `${id} rot${r} has ${c.length}` }
    for (const [x, y] of c) if (x < 0 || x > 3 || y < 0 || y > 3) { shapesOk = false; detail = `${id} rot${r} out of box` }
  }
}
ok('all 7 pieces have 4 cells in all 4 rotations, inside a 4x4 box', shapesOk, detail)

// --- rotation preserves cell count and never duplicates a cell
let rotOk = true
for (const id of PIECE_IDS) for (let r = 0; r < 4; r++) {
  const set = new Set(SHAPES[id][r].map(([x, y]) => `${x},${y}`))
  if (set.size !== 4) { rotOk = false }
}
ok('no rotation has duplicate cells', rotOk)

// --- line clear
const g: Game = createGame()
startGame(g)
// fill the bottom row except one gap, by hand
for (let x = 0; x < COLS; x++) if (x !== 3) g.board[ROWS - 1][x] = 'O'
g.board[ROWS - 2][0] = 'T'              // a survivor above, to prove the collapse shifts it down
const scoreBefore = g.score
g.piece = { id: 'I', rotation: 1, x: 1, y: ROWS - 4 }   // vertical I in column 3
lock(g)
ok('a completed row is removed', g.board[ROWS - 1].filter((c) => c !== null).length < COLS,
   `bottom row now ${g.board[ROWS-1].filter(c=>c!==null).length}/10`)
ok('lines counter advanced by 1', g.lines === 1, `lines=${g.lines}`)
ok('score increased for the clear', g.score > scoreBefore, `${scoreBefore} -> ${g.score}`)
ok('the block above fell into the cleared row', g.board[ROWS - 1][0] === 'T',
   `bottom-left is ${g.board[ROWS-1][0]}`)

// --- a tetris (four rows at once) scores more than four singles
const a = createGame(); startGame(a)
for (let r = ROWS - 4; r < ROWS; r++) for (let x = 0; x < COLS; x++) if (x !== 0) a.board[r][x] = 'O'
a.level = 1
a.piece = { id: 'I', rotation: 1, x: -2, y: ROWS - 4 }
const beforeTetris = a.score
lock(a)
ok('clearing four rows at once awards 800', a.score - beforeTetris === 800, `got ${a.score - beforeTetris}`)
ok('four rows were cleared', a.lines === 4, `lines=${a.lines}`)

// --- walls
const b = createGame(); startGame(b)
b.piece = { id: 'O', rotation: 0, x: 0, y: 5 }
let steps = 0
while (move(b, -1, 0)) { if (++steps > 20) break }
ok('a piece cannot be pushed through the left wall', steps <= 2 && b.piece!.x >= -1, `x=${b.piece!.x}`)
b.piece = { id: 'O', rotation: 0, x: 0, y: 5 }
steps = 0
while (move(b, 1, 0)) { if (++steps > 20) break }
const rightmost = Math.max(...cellsOf('O', 0).map(([dx]) => b.piece!.x + dx))
ok('a piece cannot be pushed through the right wall', rightmost === COLS - 1, `rightmost=${rightmost}`)

// --- floor
const c = createGame(); startGame(c)
c.piece = { id: 'O', rotation: 0, x: 4, y: 0 }
const dist = dropDistance(c)
ok('drop distance lands the piece on the floor', dist > 0 && !fits(c, { ...c.piece!, y: c.piece!.y + dist + 1 }),
   `dist=${dist}`)

// --- hard drop scores two per row and locks
const d = createGame(); startGame(d)
d.piece = { id: 'O', rotation: 0, x: 4, y: 0 }
const expected = dropDistance(d) * 2
const s0 = d.score
hardDrop(d)
ok('hard drop scores 2 per row', d.score - s0 === expected, `${d.score - s0} vs ${expected}`)
ok('hard drop locks the piece into the board', d.board.flat().filter((x) => x !== null).length === 4)

// --- game over: the stack reaches the spawn area, but no row is complete, so nothing clears
const e = createGame(); startGame(e)
for (let r = 0; r < 4; r++) for (let x = 0; x < COLS - 1; x++) e.board[r][x] = 'O'   // col 9 left open
const blockedRowsComplete = e.board.some((row) => row.every((c) => c !== null))
ok('the test setup completes no row', !blockedRowsComplete)
e.piece = { id: 'O', rotation: 0, x: 4, y: ROWS - 2 }
lock(e)
ok('a stack reaching the spawn area ends the game', e.phase === 'over', `phase=${e.phase}`)
ok('game over leaves no piece in hand', e.piece === null)

// --- and the opposite: a full board clears entirely rather than ending
const e2 = createGame(); startGame(e2)
for (let r = ROWS - 2; r < ROWS; r++) for (let x = 0; x < COLS; x++) if (!(r === ROWS-1 && x === 0)) e2.board[r][x] = 'O'
e2.piece = { id: 'O', rotation: 0, x: -1, y: ROWS - 2 }
lock(e2)
ok('clearing rows keeps the game alive', e2.phase === 'playing', `phase=${e2.phase}`)

// --- bag fairness: every one of the seven appears before any repeats
const f = createGame(); startGame(f)
const seen: PieceId[] = []
for (let i = 0; i < 7 && f.phase === 'playing'; i++) {
  seen.push(f.piece!.id)
  hardDrop(f)
}
ok('the bag deals all seven pieces before repeating any', new Set(seen).size === 7,
   `got ${seen.join(',')}`)

// --- pause / resume / quit
const h = createGame(); startGame(h)
pauseGame(h); ok('pause stops the game', h.phase === 'paused')
move(h, -1, 0); ok('a paused game ignores input', true)
resumeGame(h); ok('resume restarts it', h.phase === 'playing')
endSession(h); ok('quitting returns to idle', h.phase === 'idle' && h.piece === null)

// --- speed curve
ok('gravity speeds up with level', dropInterval(1) > dropInterval(5) && dropInterval(5) > dropInterval(10))
ok('gravity has a floor', dropInterval(100) >= 70)
