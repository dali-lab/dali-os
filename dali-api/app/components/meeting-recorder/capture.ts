// Browser audio capture: getUserMedia/getDisplayMedia, a live level meter,
// and the AudioWorklet pipeline that turns a MediaStream into 16kHz mono
// Int16 frames. Not unit-tested — jsdom has no AudioContext/AudioWorklet —
// so this stays a thin, side-effecting wrapper and MeetingRecorder.tsx keeps
// the actual control flow (phases, uploads) in testable pieces elsewhere in
// this directory.

export function describeMicError(err: unknown): string {
  const name = err instanceof DOMException || err instanceof Error ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone access is blocked for this site. Allow the microphone in your browser's site settings, then reload.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No microphone found on this device.";
    case "NotReadableError":
    case "TrackStartError":
      return "Another app is using the microphone. Quit it and try again.";
    default:
      return err instanceof Error && err.message ? err.message : "Couldn't open the microphone.";
  }
}

export async function openMic(deviceId?: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
    },
  });
}

export async function listMicDevices(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "audioinput");
}

/**
 * One real capture attempt doubles as the capability probe — getDisplayMedia
 * always needs a user gesture and shows the browser's share picker, so there
 * is no way to silently feature-detect "can this browser hear call audio"
 * ahead of time. Stops the video track immediately either way; returns null
 * (stream fully stopped) when the picked source has no audio track, which is
 * always true on Firefox/Safari and true on Chrome/Edge when the user picks
 * a window instead of a tab/screen.
 */
export async function captureCallAudio(): Promise<MediaStream | null> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
    // Not in the lib.dom.d.ts MediaTrackConstraints union yet; Chrome/Edge
    // read it to prefer OS-level system audio over a single tab's.
    ...({ systemAudio: "include" } as Record<string, string>),
  });
  stream.getVideoTracks().forEach((t) => t.stop());
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    return null;
  }
  return stream;
}

/** RMS level in [0, 1], sampled on every animation frame. Returns a stop fn. */
export function startLevelMeter(stream: MediaStream, onLevel: (level: number) => void): () => void {
  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  let raf = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i]! - 128) / 128;
      sum += v * v;
    }
    onLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    source.disconnect();
    void audioCtx.close();
  };
}

export type CaptureFrameHandler = (buffer: ArrayBuffer, seq: number) => void;

/**
 * Wires a MediaStream into the pcm-downsample-processor worklet and calls
 * `onFrame` with each complete 20s Int16 buffer (and the final partial one on
 * flush()). `workletUrl` is the Vite-resolved URL of worklet-processor.js.
 */
export class WorkletCapture {
  private audioCtx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private seq = 0;
  private onFlushed: (() => void) | null = null;
  private levelRaf = 0;

  /** `onLevel` is optional and shares this capture's own AudioContext/source
   *  rather than opening a second one just for metering. */
  async start(
    stream: MediaStream,
    workletUrl: string,
    onFrame: CaptureFrameHandler,
    onLevel?: (level: number) => void,
  ): Promise<void> {
    const audioCtx = new AudioContext();
    this.audioCtx = audioCtx;
    await audioCtx.audioWorklet.addModule(workletUrl);
    const source = audioCtx.createMediaStreamSource(stream);
    this.source = source;
    const node = new AudioWorkletNode(audioCtx, "pcm-downsample-processor");
    this.node = node;
    node.port.onmessage = (event: MessageEvent) => {
      const data = event.data as { type: string; buffer?: ArrayBuffer };
      if (data.type === "frame" && data.buffer) {
        onFrame(data.buffer, this.seq++);
      } else if (data.type === "flushed") {
        this.onFlushed?.();
        this.onFlushed = null;
      }
    };
    source.connect(node);
    // Some browsers stop processing a worklet node with no path to the
    // destination. A zero-gain tap keeps it alive without any audible
    // playback or local echo.
    const silence = audioCtx.createGain();
    silence.gain.value = 0;
    node.connect(silence);
    silence.connect(audioCtx.destination);

    if (onLevel) {
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      this.analyser = analyser;
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i]! - 128) / 128;
          sum += v * v;
        }
        onLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
        this.levelRaf = requestAnimationFrame(tick);
      };
      this.levelRaf = requestAnimationFrame(tick);
    }
  }

  /** Posts whatever's buffered (even a partial frame) and resolves once it has. */
  flush(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.node) {
        resolve();
        return;
      }
      this.onFlushed = resolve;
      this.node.port.postMessage({ type: "flush" });
    });
  }

  stop(): void {
    if (this.levelRaf) cancelAnimationFrame(this.levelRaf);
    this.node?.disconnect();
    this.source?.disconnect();
    this.analyser?.disconnect();
    void this.audioCtx?.close();
    this.node = null;
    this.source = null;
    this.analyser = null;
    this.audioCtx = null;
  }
}
