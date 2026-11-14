import { useEffect, useRef, useState } from 'react'
import { useLeaderboard } from '~/hooks/useLeaderboard'
import Leaderboard from '../week5/tetris/Leaderboard'
import { createRunAudio } from './audio'
import { createTunnelScene, type ScenePhase, type TunnelScene } from './scene'
import './technigala.css'

/**
 * Week 10: Technigala. The poster's film-strip tunnel as the home scene, with a run down it for
 * anyone who holds on the tunnel and lets go.
 */
export default function TechnigalaBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<TunnelScene | null>(null)
  const scoreRef = useRef<HTMLSpanElement>(null)
  const runs = useRef(0)
  const [phase, setPhase] = useState<ScenePhase>('attract')
  const [finalScore, setFinalScore] = useState(0)
  const [muted, setMuted] = useState(false)
  const [firstRun, setFirstRun] = useState(false)
  const board = useLeaderboard('/api/landing/tunnel-scores')
  const { submit, clearPersonalBest } = board

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
      onOver: (score) => {
        setFinalScore(score)
        void submit({ score })
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

  const playing = phase === 'play' || phase === 'paused'
  useEffect(() => {
    if (phase !== 'play' || runs.current > 0) return
    runs.current += 1
    setFirstRun(true)
    const timer = setTimeout(() => setFirstRun(false), 4500)
    return () => clearTimeout(timer)
  }, [phase])

  const best = board.you?.score ?? 0

  return (
    <div className="landing-background landing-technigala" data-phase={phase}>
      <canvas ref={canvasRef} className="tg-canvas" aria-hidden="true" />
      <div className="landing-scrim" />

      {playing && (
        <div className="tg-hud">
          <p className="tg-label">Score</p>
          <span ref={scoreRef} className="tg-score">
            0
          </span>
          <p className="tg-sub">
            {best > 0 && <>Best {best.toLocaleString()} · </>}P to pause · M to mute · Esc to stop
          </p>
          <div className="tg-hud-actions">
            <HudButton onPress={() => sceneRef.current?.togglePause()}>
              {phase === 'paused' ? 'Keep going' : 'Pause'}
            </HudButton>
            <HudButton onPress={() => sceneRef.current?.toggleMute()} pressed={muted}>
              {muted ? 'Sound off' : 'Sound on'}
            </HudButton>
          </div>
        </div>
      )}

      {phase === 'play' && firstRun && (
        <p className="tg-help">← → move around the tunnel · Space or tap to jump</p>
      )}

      {phase === 'paused' && (
        <div className="tg-card tg-paused">
          <p className="tg-card-title">Paused</p>
          <p className="tg-card-note">Press P to keep going</p>
        </div>
      )}

      {phase === 'over' && (
        <div className="tg-card tg-over">
          <p className="tg-label">Your score</p>
          <p className="tg-final">{finalScore.toLocaleString()}</p>
          {board.personalBest && <p className="tg-card-note">New personal best</p>}
          {board.available && <Leaderboard board={board} />}
          <div className="tg-actions">
            <button type="button" className="tg-button tg-button-primary" onClick={() => sceneRef.current?.start()}>
              Run again
            </button>
            <button type="button" className="tg-button" onClick={() => sceneRef.current?.exit()}>
              Back to the scene
            </button>
          </div>
          <p className="tg-keys">Space to run again · Esc to leave</p>
        </div>
      )}
    </div>
  )
}

/** Never takes focus, so Space keeps jumping instead of pressing the button again. */
function HudButton({ onPress, pressed, children }: { onPress: () => void; pressed?: boolean; children: string }) {
  return (
    <button
      type="button"
      className="tg-hud-button"
      aria-pressed={pressed}
      onPointerDown={(event) => event.preventDefault()}
      onClick={onPress}
    >
      {children}
    </button>
  )
}
