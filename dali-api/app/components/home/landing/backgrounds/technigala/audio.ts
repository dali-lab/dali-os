/*
 * The run's sound: an original synth loop in A minor and a few effects, made live with Web Audio so
 * there is no file to download. It only plays during a run; the scene itself is silent.
 */

const MUTE_KEY = 'dali:tunnel-run:muted'
const VOLUME = 0.5
// Am, F, C, G as MIDI notes: root, third, fifth, octave
const CHORDS = [
  [45, 48, 52, 57],
  [41, 45, 48, 53],
  [48, 52, 55, 60],
  [43, 47, 50, 55],
]
const ARP = [0, 1, 2, 3, 2, 1, 2, 3]

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

export type RunAudio = ReturnType<typeof createRunAudio>

export function createRunAudio() {
  let ac: AudioContext | null = null
  let master: GainNode
  let music: GainNode
  let sfx: GainNode
  let echo: DelayNode
  let noiseBuffer: AudioBuffer
  let timer: ReturnType<typeof setInterval> | null = null
  let step = 0
  let next = 0
  let playing = false
  let intensity = 0
  let alive = 0
  let muted = readMuted()

  function ensure() {
    if (ac) return true
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return false
    try {
      ac = new Ctor()
    } catch {
      return false
    }
    const comp = ac.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 4
    comp.connect(ac.destination)
    master = ac.createGain()
    master.gain.value = muted ? 0 : VOLUME
    master.connect(comp)
    music = ac.createGain()
    music.gain.value = 0
    music.connect(master)
    sfx = ac.createGain()
    sfx.gain.value = 0.9
    sfx.connect(master)
    echo = ac.createDelay(1)
    echo.delayTime.value = 0.36
    const feedback = ac.createGain()
    feedback.gain.value = 0.32
    const wet = ac.createGain()
    wet.gain.value = 0.28
    echo.connect(feedback)
    feedback.connect(echo)
    echo.connect(wet)
    wet.connect(music)
    noiseBuffer = ac.createBuffer(1, ac.sampleRate, ac.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    return true
  }

  function envelope(g: GainNode, t: number, attack: number, peak: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
  }

  function tone(type: OscillatorType, f0: number, f1: number, t: number, dur: number, peak: number, out: AudioNode, attack = 0.004) {
    const a = ac as AudioContext
    const o = a.createOscillator()
    const g = a.createGain()
    o.type = type
    o.frequency.setValueAtTime(f0, t)
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur)
    envelope(g, t, attack, peak, dur)
    o.connect(g)
    g.connect(out)
    o.start(t)
    o.stop(t + attack + dur + 0.05)
  }

  function noise(t: number, dur: number, peak: number, type: BiquadFilterType, freq: number, out: AudioNode) {
    const a = ac as AudioContext
    const s = a.createBufferSource()
    s.buffer = noiseBuffer
    const f = a.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    const g = a.createGain()
    envelope(g, t, 0.002, peak, dur)
    s.connect(f)
    f.connect(g)
    g.connect(out)
    s.start(t, Math.random() * 0.5)
    s.stop(t + dur + 0.05)
  }

  function bass(t: number, m: number, dur: number) {
    const a = ac as AudioContext
    const o = a.createOscillator()
    o.type = 'sawtooth'
    o.frequency.value = hz(m)
    const f = a.createBiquadFilter()
    f.type = 'lowpass'
    f.Q.value = 5
    f.frequency.setValueAtTime(320 + 1300 * intensity, t)
    f.frequency.exponentialRampToValueAtTime(110, t + dur)
    const g = a.createGain()
    envelope(g, t, 0.004, 0.3, dur)
    o.connect(f)
    f.connect(g)
    g.connect(music)
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  function arp(t: number, m: number) {
    const a = ac as AudioContext
    const o = a.createOscillator()
    o.type = 'square'
    o.frequency.value = hz(m)
    const f = a.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 1600 + 2600 * intensity
    const g = a.createGain()
    envelope(g, t, 0.003, 0.06, 0.11)
    o.connect(f)
    f.connect(g)
    g.connect(music)
    g.connect(echo)
    o.start(t)
    o.stop(t + 0.2)
  }

  function pad(t: number, chord: number[], dur: number) {
    const a = ac as AudioContext
    const f = a.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 700 + 900 * intensity
    const g = a.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.035, t + 0.35)
    g.gain.setValueAtTime(0.035, t + dur - 0.2)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1)
    f.connect(g)
    g.connect(music)
    for (const m of chord.slice(1)) {
      for (const detune of [-7, 7]) {
        const o = a.createOscillator()
        o.type = 'sawtooth'
        o.frequency.value = hz(m + 12)
        o.detune.value = detune
        o.connect(f)
        o.start(t)
        o.stop(t + dur + 0.15)
      }
    }
  }

  function schedule(t: number, sixteenth: number) {
    const s = step % 16
    const bar = Math.floor(step / 16)
    const chord = CHORDS[bar % 4]
    if (s % 4 === 0) tone('sine', 150, 42, t, 0.26, 0.9, music, 0.002)
    if (bar >= 2 && (s === 4 || s === 12)) {
      noise(t, 0.13, 0.2, 'bandpass', 1900, music)
      tone('triangle', 220, 140, t, 0.08, 0.12, music)
    }
    if (bar >= 1) {
      if (s % 4 === 2) noise(t, 0.05, 0.11, 'highpass', 7000, music)
      else if (intensity > 0.3 && s % 2 === 1) noise(t, 0.03, 0.045, 'highpass', 8500, music)
    }
    if (s % 2 === 0) bass(t, chord[0] + (s % 8 === 6 ? 12 : 0), sixteenth * 1.7)
    if (bar >= 2) arp(t, chord[ARP[s % 8]] + 24)
    if (s === 0 && bar >= 1) pad(t, chord, sixteenth * 16)
  }

  function pump() {
    if (!playing || !ac || ac.state !== 'running') return
    const sixteenth = 60 / (124 + 28 * intensity) / 4
    // No frames means the page is hidden or the scene is off screen: hold the beat rather than
    // scheduling notes for a game nobody can see.
    if (performance.now() - alive > 250) {
      next = ac.currentTime + 0.05
      return
    }
    while (next < ac.currentTime + 0.12) {
      schedule(next, sixteenth)
      next += sixteenth
      step++
    }
  }

  return {
    start() {
      if (!ensure() || !ac) return
      if (ac.state !== 'running') void ac.resume()
      const t = ac.currentTime
      playing = true
      step = 0
      intensity = 0
      alive = performance.now()
      next = t + 0.08
      music.gain.cancelScheduledValues(t)
      music.gain.setValueAtTime(0.0001, t)
      music.gain.exponentialRampToValueAtTime(1, t + 0.25)
      noise(t, 0.5, 0.18, 'bandpass', 900, sfx)
      if (timer) clearInterval(timer)
      timer = setInterval(pump, 25)
    },
    stop() {
      playing = false
      if (timer) clearInterval(timer)
      timer = null
      if (!ac) return
      const t = ac.currentTime
      music.gain.cancelScheduledValues(t)
      music.gain.setValueAtTime(Math.max(0.0001, music.gain.value), t)
      music.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
    },
    pause(paused: boolean) {
      if (!ac || !playing) return
      if (paused) void ac.suspend()
      else {
        alive = performance.now()
        void ac.resume()
      }
    },
    /** Called every frame of a run with how far it is into its speed-up. */
    frame(boost: number) {
      intensity = boost
      alive = performance.now()
    },
    jump() {
      if (ac && playing) tone('triangle', 440, 880, ac.currentTime, 0.12, 0.16, sfx)
    },
    land() {
      if (ac && playing) noise(ac.currentTime, 0.08, 0.3, 'lowpass', 420, sfx)
    },
    fall() {
      if (ac && playing) tone('sine', 560, 60, ac.currentTime, 0.95, 0.24, sfx)
    },
    get muted() {
      return muted
    },
    toggleMute() {
      muted = !muted
      try {
        localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
      } catch {
        // Private windows can refuse storage; the setting just won't stick.
      }
      if (ac) master.gain.setTargetAtTime(muted ? 0 : VOLUME, ac.currentTime, 0.03)
      return muted
    },
    close() {
      this.stop()
      void ac?.close()
      ac = null
    },
  }
}
