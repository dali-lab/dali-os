/**
 * The game itself: a board, a falling piece, and the rules for moving it.
 *
 * Deliberately plain. Everything here is synchronous and framework-free -- it is mutated in place
 * by the hook that owns it, once per animation frame, rather than being copied into new state
 * objects. A tetris board changes a handful of cells at a time and is read sixty times a second,
 * so copying 200 cells per keypress buys nothing and costs the garbage collector.
 */
import { KICKS, PIECE_IDS, SHAPES, type Cells, type PieceId } from './pieces'

export const COLS = 10
export const ROWS = 20

export type Cell = PieceId | null
export type Phase = 'idle' | 'playing' | 'paused' | 'over'

export interface ActivePiece {
  id: PieceId
  rotation: number
  /** Column and row of the shape's own 4x4 box, top-left. */
  x: number
  y: number
}

export interface Game {
  board: Cell[][]
  piece: ActivePiece | null
  /** The seven-bag the next pieces are drawn from, already shuffled. */
  bag: PieceId[]
  next: PieceId[]
  phase: Phase
  score: number
  lines: number
  level: number
  /** Rows cleared by the last lock, for the flash. Emptied once it has been shown. */
  clearing: number[]
  /** Bumped whenever anything visible changes, so React knows to paint. */
  version: number
}

export function createGame(): Game {
  return {
    board: emptyBoard(),
    piece: null,
    bag: [],
    next: [],
    phase: 'idle',
    score: 0,
    lines: 0,
    level: 1,
    clearing: [],
    version: 0,
  }
}

function emptyBoard(): Cell[][] {
  return Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null))
}

/**
 * Pieces come from a shuffled bag of all seven rather than at random. It is the standard way and
 * it matters: true randomness regularly deals four S pieces in a row, which reads as the game
 * cheating. A bag guarantees you never wait more than twelve pieces for the one you need.
 */
function refillBag(game: Game): void {
  const bag = [...PIECE_IDS]
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[bag[i], bag[j]] = [bag[j], bag[i]]
  }
  game.bag.push(...bag)
}

function takeFromBag(game: Game): PieceId {
  if (game.bag.length === 0) refillBag(game)
  return game.bag.shift()!
}

export function startGame(game: Game): void {
  game.board = emptyBoard()
  game.bag = []
  game.next = []
  game.score = 0
  game.lines = 0
  game.level = 1
  game.clearing = []
  game.phase = 'playing'
  while (game.next.length < 3) game.next.push(takeFromBag(game))
  spawn(game)
  game.version++
}

export function cellsOf(id: PieceId, rotation: number): Cells {
  return SHAPES[id][((rotation % 4) + 4) % 4]
}

/** Does this piece, at this position, sit entirely in empty space inside the walls? */
export function fits(game: Game, piece: ActivePiece): boolean {
  for (const [dx, dy] of cellsOf(piece.id, piece.rotation)) {
    const x = piece.x + dx
    const y = piece.y + dy
    if (x < 0 || x >= COLS || y >= ROWS) return false
    // Above the ceiling is legal: that is where a piece spawns and spins before it comes down.
    if (y < 0) continue
    if (game.board[y][x] !== null) return false
  }
  return true
}

function spawn(game: Game): void {
  const id = game.next.shift()!
  game.next.push(takeFromBag(game))
  // Spawned fully inside the well rather than in a hidden buffer above it. The buffer is what
  // the standard rules do, but it means the first move of every piece is made blind, which on a
  // page where most people will play for thirty seconds is just confusing.
  const piece: ActivePiece = { id, rotation: 0, x: Math.floor((COLS - 4) / 2), y: 0 }
  // If the new piece has nowhere to stand, the stack has reached the top.
  if (!fits(game, piece)) {
    game.piece = null
    game.phase = 'over'
    return
  }
  game.piece = piece
}

export function move(game: Game, dx: number, dy: number): boolean {
  if (game.phase !== 'playing' || !game.piece) return false
  const moved = { ...game.piece, x: game.piece.x + dx, y: game.piece.y + dy }
  if (!fits(game, moved)) return false
  game.piece = moved
  game.version++
  return true
}

export function rotate(game: Game, turn: 1 | -1): boolean {
  if (game.phase !== 'playing' || !game.piece) return false
  const rotation = game.piece.rotation + turn
  for (const [kx, ky] of KICKS) {
    const turned = { ...game.piece, rotation, x: game.piece.x + kx, y: game.piece.y + ky }
    if (fits(game, turned)) {
      game.piece = turned
      game.version++
      return true
    }
  }
  return false
}

/** How far down the piece can go from where it is -- used for the ghost and the hard drop. */
export function dropDistance(game: Game): number {
  if (!game.piece) return 0
  let distance = 0
  while (fits(game, { ...game.piece, y: game.piece.y + distance + 1 })) distance++
  return distance
}

export function hardDrop(game: Game): void {
  if (game.phase !== 'playing' || !game.piece) return
  const distance = dropDistance(game)
  game.piece = { ...game.piece, y: game.piece.y + distance }
  // Two points a row, the usual reward for committing rather than waiting out the gravity.
  game.score += distance * 2
  lock(game)
}

/** Gravity's step. Returns false when the piece could not fall, which is what locks it. */
export function tick(game: Game): void {
  if (game.phase !== 'playing' || !game.piece) return
  if (!move(game, 0, 1)) lock(game)
}

export function softDrop(game: Game): void {
  if (game.phase !== 'playing' || !game.piece) return
  if (move(game, 0, 1)) game.score += 1
  else lock(game)
}

const LINE_SCORES = [0, 100, 300, 500, 800]

export function lock(game: Game): void {
  const piece = game.piece
  if (!piece) return
  for (const [dx, dy] of cellsOf(piece.id, piece.rotation)) {
    const x = piece.x + dx
    const y = piece.y + dy
    if (y >= 0 && y < ROWS && x >= 0 && x < COLS) game.board[y][x] = piece.id
  }

  const full: number[] = []
  for (let y = 0; y < ROWS; y++) {
    if (game.board[y].every((cell) => cell !== null)) full.push(y)
  }
  if (full.length > 0) {
    for (const y of full) game.board.splice(y, 1)
    for (let i = 0; i < full.length; i++) game.board.unshift(Array<Cell>(COLS).fill(null))
    game.lines += full.length
    game.score += LINE_SCORES[full.length] * game.level
    game.level = Math.floor(game.lines / 10) + 1
    game.clearing = full
  }

  game.piece = null
  spawn(game)
  game.version++
}

/**
 * Milliseconds a piece takes to fall one row. Roughly the classic curve: comfortable at first,
 * and past level 10 fast enough that you are placing pieces on reflex.
 */
export function dropInterval(level: number): number {
  return Math.max(70, 800 - (level - 1) * 70)
}

/**
 * Phase changes the player asks for.
 *
 * These exist so that every mutation of a game lives in this file. The hook that owns the game
 * holds it as one long-lived object and never assigns to its fields directly, which keeps the
 * "who is allowed to change this" question to a single answer.
 */
export function pauseGame(game: Game): void {
  if (game.phase !== 'playing') return
  game.phase = 'paused'
  game.version++
}

export function resumeGame(game: Game): void {
  if (game.phase !== 'paused') return
  game.phase = 'playing'
  game.version++
}

/** Leave the game and hand the page back to the looping board art. */
export function endSession(game: Game): void {
  game.phase = 'idle'
  game.piece = null
  game.version++
}
