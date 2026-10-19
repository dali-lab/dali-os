import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A game's high-score board (see lib/game-scores.server.ts), and reporting a
 * finished game to it.
 *
 * Fetched rather than loaded with the page: the pages hosting these games
 * mostly render without anyone playing, so the board is asked for once the
 * game is on screen and not before.
 */

export type LeaderboardEntry<Extra = object> = {
  rank: number
  userId: string
  name: string
  score: number
  achievedAt: string
} & Extra

export type LeaderboardState<Extra = object> = {
  entries: LeaderboardEntry<Extra>[]
  you: LeaderboardEntry<Extra> | null
  /** True from the first request until an answer, so the panel can hold its shape. */
  loading: boolean
  /** True once the server has answered with a board. Stays false for anyone it
   *  turns away (not a member, not signed in), so the panel can stay hidden. */
  available: boolean
  /** Set when the last game beat the player's own record. Cleared when a new game starts. */
  personalBest: boolean
}

type Payload<Extra> = {
  entries?: LeaderboardEntry<Extra>[]
  you?: LeaderboardEntry<Extra> | null
  personalBest?: boolean
}

export function useLeaderboard<Extra = object>(endpoint: string, enabled: boolean) {
  const [state, setState] = useState<LeaderboardState<Extra>>({
    entries: [],
    you: null,
    loading: enabled,
    available: false,
    personalBest: false,
  })

  // Nothing from a request that is already overtaken should land: a game ending
  // while the opening read is still out would otherwise be replaced by it.
  const request = useRef(0)
  // Survives unmount — the game can go away mid-flight.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const apply = useCallback((seq: number, payload: Payload<Extra>, personalBest: boolean) => {
    if (!alive.current || seq !== request.current) return
    setState({
      entries: payload.entries ?? [],
      you: payload.you ?? null,
      loading: false,
      available: true,
      personalBest,
    })
  }, [])

  const load = useCallback(async () => {
    const seq = ++request.current
    try {
      const res = await fetch(endpoint, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(String(res.status))
      apply(seq, await res.json(), false)
    } catch {
      // A board that won't load is not a reason to interrupt a game, so this
      // fails quietly and the panel says it is unavailable.
      if (alive.current && seq === request.current) {
        setState((s) => ({ ...s, loading: false }))
      }
    }
  }, [apply, endpoint])

  useEffect(() => {
    if (enabled) void load()
  }, [enabled, load])

  /** Report a finished game. The server keeps it only if it beats the player's best. */
  const submit = useCallback(
    async (run: { score: number } & Extra) => {
      const seq = ++request.current
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(run),
        })
        if (!res.ok) throw new Error(String(res.status))
        const payload: Payload<Extra> = await res.json()
        apply(seq, payload, payload.personalBest === true)
      } catch {
        if (alive.current && seq === request.current) {
          setState((s) => ({ ...s, loading: false }))
        }
      }
    },
    [apply, endpoint],
  )

  /** Drop the "new best" banner when the player starts again. */
  const clearPersonalBest = useCallback(() => {
    setState((s) => (s.personalBest ? { ...s, personalBest: false } : s))
  }, [])

  return { ...state, submit, clearPersonalBest }
}

/** The top `limit` places, plus the caller's own row when it didn't make the
 *  cut, so a board always answers "where am I" and not only "who is winning". */
export function visibleRows<Extra>(board: LeaderboardState<Extra>, limit?: number) {
  const shown = limit ? board.entries.slice(0, limit) : board.entries
  const you = board.you
  const trailing = you && !shown.some((e) => e.userId === you.userId) ? you : null
  return { shown, trailing }
}
