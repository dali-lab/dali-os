import { useCallback, useEffect, useState } from 'react'
import {
  createGame,
  dropInterval,
  endSession,
  hardDrop,
  move,
  pauseGame,
  resumeGame,
  rotate,
  softDrop,
  startGame,
  tick,
  type Game,
  type Phase,
} from './engine'

/**
 * Owns a game and runs its clock.
 *
 * The game is one long-lived object that gets mutated in place; rebuilding the board into fresh
 * state on every keypress and every gravity tick would make rendering the expensive part of a
 * game that is otherwise almost free. React is told about changes through two pieces of state:
 * `version`, bumped on anything visible, and `phase`.
 *
 * Phase is kept separately rather than read off the game object, because the effects below have
 * to start and stop with it. Hanging them off the version instead would tear down and rebuild the
 * animation frame loop sixty times a second.
 */
export function useTetris() {
  // Created once. The identity never changes -- it is the contents that move.
  const [game] = useState<Game>(createGame)
  const [, setVersion] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')

  const sync = useCallback(() => {
    setVersion(game.version)
    setPhase(game.phase)
  }, [game])

  const start = useCallback(() => {
    startGame(game)
    sync()
  }, [game, sync])

  const quit = useCallback(() => {
    endSession(game)
    sync()
  }, [game, sync])

  const togglePause = useCallback(() => {
    if (game.phase === 'playing') pauseGame(game)
    else resumeGame(game)
    sync()
  }, [game, sync])

  // ---- gravity
  useEffect(() => {
    if (phase !== 'playing') return
    let raf = 0
    let last = performance.now()
    let fallen = 0

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      // A backgrounded tab resumes with a huge delta; capping it stops the piece teleporting
      // down the board the moment you come back to it.
      const delta = Math.min(now - last, 250)
      last = now
      if (game.phase !== 'playing') return
      fallen += delta
      const interval = dropInterval(game.level)
      let stepped = false
      while (fallen >= interval) {
        fallen -= interval
        tick(game)
        stepped = true
      }
      if (stepped) sync()
    }

    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [game, phase, sync])

  // ---- keyboard
  useEffect(() => {
    if (phase === 'idle') return

    const onKey = (event: KeyboardEvent) => {
      // The page has a search box and a row of links. While a game is on the arrow keys belong
      // to the game -- but only when the player is not typing somewhere, or the first thing they
      // search for silently becomes a hard drop.
      const target = event.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return
        }
      }

      let handled = true
      switch (event.key) {
        case 'ArrowLeft': move(game, -1, 0); break
        case 'ArrowRight': move(game, 1, 0); break
        case 'ArrowDown': softDrop(game); break
        case 'ArrowUp': case 'x': case 'X': rotate(game, 1); break
        case 'z': case 'Z': rotate(game, -1); break
        case ' ': hardDrop(game); break
        case 'p': case 'P': togglePause(); break
        case 'Escape': quit(); break
        default: handled = false
      }
      if (handled) {
        // Arrows and space scroll the page otherwise, which drags the board out from under you.
        event.preventDefault()
        sync()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [game, phase, quit, sync, togglePause])

  // Exposed for the on-screen buttons. They call the same engine functions the keys do rather
  // than dispatching synthetic key events, which would be a second path to keep in step.
  const act = useCallback(
    (what: 'left' | 'right' | 'down' | 'rotate' | 'slam') => {
      switch (what) {
        case 'left': move(game, -1, 0); break
        case 'right': move(game, 1, 0); break
        case 'down': softDrop(game); break
        case 'rotate': rotate(game, 1); break
        case 'slam': hardDrop(game); break
      }
      sync()
    },
    [game, sync],
  )

  return { game, phase, start, quit, togglePause, act }
}
