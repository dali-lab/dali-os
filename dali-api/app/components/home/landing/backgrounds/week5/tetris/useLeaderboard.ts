import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The high-score board, and reporting a finished game to it.
 *
 * Fetched rather than loaded with the page: the landing's loader runs on every
 * visit to home and most of those visits never start a game, so the board is
 * asked for once the scene is actually on screen and not before.
 */

const ENDPOINT = '/api/landing/tetris-scores'

export type LeaderboardEntry = {
  rank: number
  userId: string
  name: string
  score: number
  lines: number
  level: number
  achievedAt: string
}

export type LeaderboardState = {
  entries: LeaderboardEntry[]
  you: LeaderboardEntry | null
  /** True from the first request until an answer, so the panel can hold its shape. */
  loading: boolean
  /** Set when the last game beat the player's own record. Cleared when a new game starts. */
  personalBest: boolean
}

type Payload = { entries?: LeaderboardEntry[]; you?: LeaderboardEntry | null; personalBest?: boolean }

export function useLeaderboard(enabled: boolean) {
  const [state, setState] = useState<LeaderboardState>({
    entries: [],
    you: null,
    loading: enabled,
    personalBest: false,
  })

  // Nothing from a request that is already overtaken should land: a game ending
  // while the opening read is still out would otherwise be replaced by it.
  const request = useRef(0)
  // Survives unmount — the scene is lazy-loaded and can go away mid-flight.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const apply = useCallback((seq: number, payload: Payload, personalBest: boolean) => {
    if (!alive.current || seq !== request.current) return
    setState({
      entries: payload.entries ?? [],
      you: payload.you ?? null,
      loading: false,
      personalBest,
    })
  }, [])

  const load = useCallback(async () => {
    const seq = ++request.current
    try {
      const res = await fetch(ENDPOINT, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(String(res.status))
      apply(seq, await res.json(), false)
    } catch {
      // A board that won't load is not a reason to interrupt a game, so this
      // fails quietly and the panel says it is unavailable.
      if (alive.current && seq === request.current) {
        setState((s) => ({ ...s, loading: false }))
      }
    }
  }, [apply])

  useEffect(() => {
    if (enabled) void load()
  }, [enabled, load])

  /** Report a finished game. The server keeps it only if it beats the player's best. */
  const submit = useCallback(
    async (run: { score: number; lines: number; level: number }) => {
      const seq = ++request.current
      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(run),
        })
        if (!res.ok) throw new Error(String(res.status))
        const payload: Payload = await res.json()
        apply(seq, payload, payload.personalBest === true)
      } catch {
        if (alive.current && seq === request.current) {
          setState((s) => ({ ...s, loading: false }))
        }
      }
    },
    [apply],
  )

  /** Drop the "new best" banner when the player starts again. */
  const clearPersonalBest = useCallback(() => {
    setState((s) => (s.personalBest ? { ...s, personalBest: false } : s))
  }, [])

  return { ...state, submit, clearPersonalBest }
}
