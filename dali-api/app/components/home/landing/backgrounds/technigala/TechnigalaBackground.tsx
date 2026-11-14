import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useLeaderboard } from '~/hooks/useLeaderboard'
import Leaderboard from '../week5/tetris/Leaderboard'
import { createRunAudio } from './audio'
import { createTunnelScene, type RunReport, type ScenePhase, type TunnelScene } from './scene'
import './technigala.css'

// The Technigala 26F type: Saira for everything, Michroma for small caps labels. Loaded here
// rather than in root.tsx so only the week that uses them pays for them.
const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Michroma&family=Saira:wght@400;600;700&display=swap'

const SCORES_URL = '/api/landing/tunnel-scores'

function useTechnigalaFonts() {
  useEffect(() => {
    if (document.querySelector(`link[href="${FONTS_HREF}"]`)) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = FONTS_HREF
    document.head.appendChild(link)
  }, [])
}

/**
 * Week 10: Technigala. The poster's film-strip tunnel as the home scene, with a run down it for
 * anyone who holds on the tunnel and lets go.
 */
export default function TechnigalaBackground() {
  useTechnigalaFonts()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<TunnelScene | null>(null)
  const scoreRef = useRef<HTMLSpanElement>(null)
  const runs = useRef(0)
  const [phase, setPhase] = useState<ScenePhase>('attract')
  const [result, setResult] = useState({ score: 0, firstRun: false })
  const [muted, setMuted] = useState(false)
  const [firstRun, setFirstRun] = useState(false)
  const board = useLeaderboard(SCORES_URL)
  const { submit, clearPersonalBest } = board
  const hadScore = useRef(false)
  hadScore.current = board.you !== null

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const audio = createRunAudio()
    setMuted(audio.muted)
    const scene = createTunnelScene(canvas, {
      audio,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      onPhase: setPhase,
      onScore: (score) => {
        if (scoreRef.current) scoreRef.current.textContent = score.toLocaleString()
      },
      onRunEnd: (report) => {
        if (report.endedBy === 'quit') {
          void logQuit(report)
          return
        }
        setResult({ score: report.score, firstRun: !hadScore.current })
        void submit(report)
      },
      onMute: setMuted,
    })
    sceneRef.current = scene
    return () => {
      scene?.destroy()
      sceneRef.current = null
    }
  }, [submit])

  useEffect(() => {
    if (phase !== 'play') return
    clearPersonalBest()
  }, [phase, clearPersonalBest])

  useEffect(() => {
    if (phase !== 'play' || runs.current > 0) return
    runs.current += 1
    setFirstRun(true)
    const timer = setTimeout(() => setFirstRun(false), 4500)
    return () => clearTimeout(timer)
  }, [phase])

  const scene = () => sceneRef.current
  const playing = phase === 'play' || phase === 'paused'
  const best = board.you?.score ?? 0

  return (
    <div className="landing-background landing-technigala" data-phase={phase}>
      <canvas ref={canvasRef} className="tg-canvas" aria-hidden="true" />
      <div className="landing-scrim" />

      {playing && (
        <div className="tg-hud">
          <p className="tg-eyebrow">Score</p>
          <span ref={scoreRef} className="tg-score">
            0
          </span>
          {best > 0 && <p className="tg-hud-best">Best {best.toLocaleString()}</p>}
          <div className="tg-hud-actions">
            {phase === 'play' && (
              <HudButton keyName="P" onPress={() => scene()?.togglePause()}>
                Pause
              </HudButton>
            )}
            <HudButton keyName="M" onPress={() => scene()?.toggleMute()}>
              {muted ? 'Unmute' : 'Mute'}
            </HudButton>
            <HudButton keyName="Esc" onPress={() => scene()?.exit()}>
              Stop
            </HudButton>
          </div>
        </div>
      )}

      {phase === 'play' && firstRun && (
        <p className="tg-help">
          <span className="tg-for-keys">
            <Key>←</Key>
            <Key>→</Key> to steer · <Key>Space</Key> to jump
          </span>
          <span className="tg-for-touch">Drag to steer · Tap to jump</span>
        </p>
      )}

      {phase === 'paused' && (
        <div className="tg-card">
          <p className="tg-card-title">Paused</p>
          <div className="tg-actions">
            <button type="button" className="tg-button tg-button-primary" onClick={() => scene()?.togglePause()}>
              Keep going <Key>P</Key>
            </button>
            <button type="button" className="tg-button tg-button-text" onClick={() => scene()?.exit()}>
              Stop run
            </button>
          </div>
        </div>
      )}

      {phase === 'over' && (
        <div className="tg-card">
          <p className="tg-eyebrow">Your run</p>
          <p className="tg-final">{result.score.toLocaleString()}</p>
          <p className="tg-card-note">
            {board.personalBest
              ? result.firstRun
                ? 'Your first run is on the board'
                : 'New personal best'
              : best > 0 && `Your best is ${best.toLocaleString()}`}
          </p>
          {board.available && <Leaderboard board={board} />}
          <div className="tg-actions">
            <button type="button" className="tg-button tg-button-primary" onClick={() => scene()?.start()}>
              Run again <Key>Space</Key>
            </button>
            <button type="button" className="tg-button tg-button-text" onClick={() => scene()?.exit()}>
              Done <Key>Esc</Key>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** A run left early still counts for the run log, but it never moves the board. */
function logQuit(report: RunReport) {
  return fetch(SCORES_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report),
    // The page may be on its way out when a run is abandoned.
    keepalive: true,
  }).catch(() => undefined)
}

function Key({ children }: { children: ReactNode }) {
  return <kbd className="tg-key">{children}</kbd>
}

/** Never takes focus, so Space keeps jumping instead of pressing the button again. */
function HudButton({
  keyName,
  onPress,
  children,
}: {
  keyName: string
  onPress: () => void
  children: string
}) {
  return (
    <button
      type="button"
      className="tg-hud-button"
      aria-keyshortcuts={keyName === 'Esc' ? 'Escape' : keyName}
      onPointerDown={(event) => event.preventDefault()}
      onClick={onPress}
    >
      {children}
      <Key>{keyName}</Key>
    </button>
  )
}
