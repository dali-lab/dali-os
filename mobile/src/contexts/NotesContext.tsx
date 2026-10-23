import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioStream, type AudioStreamBuffer } from 'expo-audio';
import { ApiError, api, errorMessage, uploadChunk } from '../api/client';
import type { NoteSummary, NotesResponse } from '../api/contract';
import { ChunkAssembler, SAMPLE_RATE, downsample, level, mixToMono } from '../notes/pcm';
import { ChunkUploadQueue } from '../notes/uploadQueue';

const POLL_MS = 3000;
const DRAIN_MS = 20_000;

export type RecorderPhase = 'recording' | 'paused' | 'finishing' | 'processing' | 'writing' | 'failed';

export interface MeetingTarget {
  id: string;
  title: string;
  start: string;
  end: string;
  occurrenceStart: string;
}

/** Where a recording's notes go: a calendar meeting's notes page, or a page the member picked. */
export type RecordTarget = { kind: 'meeting'; meeting: MeetingTarget } | { kind: 'page'; title: string; documentName: string };

/** A note page open in the editor. */
export interface EditingNote {
  pageId: string;
  title: string;
}

export interface ActiveRecording {
  id: string;
  title: string;
  meeting: MeetingTarget | null;
  phase: RecorderPhase;
  /** Seconds in finished sessions; the live session adds now - sessionStartedAt. */
  recordedSeconds: number;
  sessionStartedAt: number | null;
  error: string | null;
}

interface NotesContextValue {
  notes: NotesResponse | null;
  loading: boolean;
  error: string | null;
  /** A one-off message for a toast, e.g. the notes couldn't be written after transcription. */
  notice: string | null;
  clearNotice: () => void;
  active: ActiveRecording | null;
  /** Microphone loudness while recording, 0..1. */
  inputLevel: number;
  recorderVisible: boolean;
  viewingId: string | null;
  editing: EditingNote | null;
  load: () => Promise<void>;
  /** Starts recording into a meeting's notes or a picked page. Resolves to an error message, or null. */
  startRecording: (target: RecordTarget) => Promise<string | null>;
  pauseRecording: () => Promise<void>;
  resumeRecording: () => Promise<void>;
  finishRecording: () => Promise<void>;
  discardRecording: () => Promise<void>;
  showRecorder: () => void;
  hideRecorder: () => void;
  openNote: (id: string) => void;
  closeNote: () => void;
  openEditor: (note: EditingNote) => void;
  closeEditor: () => void;
  noteForMeeting: (meetingId: string, occurrenceStart: string) => NoteSummary | undefined;
  reset: () => void;
}

const NotesContext = createContext<NotesContextValue | null>(null);

export function elapsedSeconds(rec: ActiveRecording, nowMs: number): number {
  return rec.recordedSeconds + (rec.sessionStartedAt ? Math.max(0, (nowMs - rec.sessionStartedAt) / 1000) : 0);
}

function startErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return errorMessage(err);
  const body = (err.body ?? {}) as { error?: string; ownerIsYou?: boolean; ownerName?: string };
  if (body.error === 'alreadyRecording') {
    return body.ownerIsYou ? 'You’re already recording this meeting on another device.' : `${body.ownerName ?? 'Someone'} is already recording this meeting.`;
  }
  if (body.error === 'recordingDisabled') return 'Recording is turned off for this project.';
  if (body.error === 'noteRequired') return 'This meeting needs a notes page first. Add one in DALI OS.';
  if (body.error === 'forbidden') return 'You can’t add notes to this meeting.';
  if (err.status === 403) return 'Meeting notes aren’t turned on for you yet.';
  return err.message;
}

export function NotesProvider({ children }: { children: React.ReactNode }) {
  const [notes, setNotes] = useState<NotesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveRecording | null>(null);
  const [inputLevel, setInputLevel] = useState(0);
  const [recorderVisible, setRecorderVisible] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingNote | null>(null);

  const activeRef = useRef<ActiveRecording | null>(null);
  activeRef.current = active;
  const capturing = useRef(false);
  const assembler = useRef(new ChunkAssembler());
  const queue = useRef<ChunkUploadQueue | null>(null);
  const segment = useRef(0);
  const seq = useRef(0);
  const lastLevelAt = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pauseRef = useRef<() => Promise<void>>(async () => {});

  const enqueue = useCallback((pcm: ArrayBuffer) => {
    queue.current?.enqueue({ segment: segment.current, seq: seq.current++, pcm });
  }, []);

  const onBuffer = useCallback(
    (buffer: AudioStreamBuffer) => {
      if (!capturing.current) return;
      const mono = downsample(mixToMono(new Float32Array(buffer.data), buffer.channels), buffer.sampleRate, SAMPLE_RATE);
      for (const chunk of assembler.current.push(mono)) enqueue(chunk);
      const now = Date.now();
      if (now - lastLevelAt.current > 120) {
        lastLevelAt.current = now;
        setInputLevel(level(mono));
      }
    },
    [enqueue],
  );

  const { stream } = useAudioStream({ sampleRate: SAMPLE_RATE, channels: 1, encoding: 'float32', onBuffer });

  const patchActive = useCallback((patch: Partial<ActiveRecording>) => {
    setActive((a) => (a ? { ...a, ...patch } : a));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setNotes(await api.notes());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const stopCapture = useCallback(async () => {
    capturing.current = false;
    stream.stop();
    setInputLevel(0);
    const rest = assembler.current.flush();
    if (rest) enqueue(rest);
    return queue.current ? queue.current.drain(DRAIN_MS) : true;
  }, [stream, enqueue]);

  const startCapture = useCallback(async () => {
    assembler.current = new ChunkAssembler();
    seq.current = 0;
    await stream.start();
    capturing.current = true;
  }, [stream]);

  const endSession = useCallback(async (rec: ActiveRecording) => {
    const seconds = rec.sessionStartedAt ? (Date.now() - rec.sessionStartedAt) / 1000 : 0;
    await api.recordingAction(rec.id, { action: 'finish', seconds });
    return rec.recordedSeconds + seconds;
  }, []);

  const startRecording = useCallback(
    async (recordTarget: RecordTarget) => {
      if (activeRef.current) {
        setRecorderVisible(true);
        return null;
      }
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) return 'Allow microphone access in Settings to record meeting notes.';
      let createdId: string | null = null;
      try {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: true, interruptionMode: 'doNotMix' });
        const meeting = recordTarget.kind === 'meeting' ? recordTarget.meeting : null;
        const title = meeting?.title ?? (recordTarget.kind === 'page' ? recordTarget.title : 'Meeting notes');
        const { id } = await api.startRecording(
          recordTarget.kind === 'meeting'
            ? { scheduledMeetingId: recordTarget.meeting.id, occurrenceStart: recordTarget.meeting.occurrenceStart }
            : { documentName: recordTarget.documentName },
        );
        createdId = id;

        segment.current = 0;
        queue.current?.destroy();
        queue.current = new ChunkUploadQueue((chunk) => uploadChunk(id, chunk), {
          onStopRequested: () => void pauseRef.current(),
          onConflict: () => {
            capturing.current = false;
            stream.stop();
            patchActive({ phase: 'failed', sessionStartedAt: null, error: 'This recording was ended from another device.' });
          },
        });
        await startCapture();
        setActive({ id, title, meeting, phase: 'recording', recordedSeconds: 0, sessionStartedAt: Date.now(), error: null });
        setViewingId(null);
        setRecorderVisible(true);
        return null;
      } catch (err) {
        capturing.current = false;
        // A row the mic never fed would otherwise hold the meeting as "already recording".
        if (createdId) void api.discardRecording(createdId).catch(() => null);
        return startErrorMessage(err);
      }
    },
    [stream, startCapture, patchActive],
  );

  const pauseRecording = useCallback(async () => {
    const rec = activeRef.current;
    if (!rec || rec.phase !== 'recording') return;
    patchActive({ phase: 'paused', sessionStartedAt: null, recordedSeconds: rec.recordedSeconds + (rec.sessionStartedAt ? (Date.now() - rec.sessionStartedAt) / 1000 : 0) });
    await stopCapture();
    try {
      await endSession(rec);
    } catch (err) {
      patchActive({ error: errorMessage(err) });
    }
  }, [patchActive, stopCapture, endSession]);
  pauseRef.current = pauseRecording;

  const resumeRecording = useCallback(async () => {
    const rec = activeRef.current;
    if (!rec || rec.phase !== 'paused') return;
    try {
      await api.recordingAction(rec.id, { action: 'resume' });
      segment.current += 1;
      await startCapture();
      patchActive({ phase: 'recording', sessionStartedAt: Date.now(), error: null });
    } catch (err) {
      patchActive({ error: errorMessage(err) });
    }
  }, [startCapture, patchActive]);

  const poll = useCallback(
    (id: string) => {
      const tick = async () => {
        if (activeRef.current?.id !== id) return;
        try {
          const state = await api.recording(id);
          if (state.status === 'Failed') {
            patchActive({ phase: 'failed', error: state.error ?? 'Transcription failed.' });
            return;
          }
          if (state.status === 'Done') {
            patchActive({ phase: 'writing' });
            const enhanceError = await api.enhanceNote(id).then(
              () => null,
              (err) => errorMessage(err),
            );
            setActive(null);
            setRecorderVisible(false);
            setViewingId(id);
            void load();
            if (enhanceError) setNotice(`Transcript saved, but the notes weren’t written: ${enhanceError}`);
            return;
          }
        } catch {
          // A dropped poll just waits for the next one.
        }
        pollTimer.current = setTimeout(tick, POLL_MS);
      };
      pollTimer.current = setTimeout(tick, POLL_MS);
    },
    [patchActive, load],
  );

  const finishRecording = useCallback(async () => {
    const rec = activeRef.current;
    if (!rec || (rec.phase !== 'recording' && rec.phase !== 'paused')) return;
    patchActive({ phase: 'finishing', error: null });
    try {
      if (rec.phase === 'recording') {
        const total = rec.recordedSeconds + (rec.sessionStartedAt ? (Date.now() - rec.sessionStartedAt) / 1000 : 0);
        patchActive({ recordedSeconds: total, sessionStartedAt: null });
        await stopCapture();
        await endSession(rec);
      }
      await api.recordingAction(rec.id, { action: 'stop', final: true });
      queue.current?.destroy();
      patchActive({ phase: 'processing' });
      poll(rec.id);
    } catch (err) {
      patchActive({ phase: 'paused', error: errorMessage(err) });
    }
  }, [patchActive, stopCapture, endSession, poll]);

  const discardRecording = useCallback(async () => {
    const rec = activeRef.current;
    if (!rec) return;
    capturing.current = false;
    stream.stop();
    queue.current?.destroy();
    queue.current = null;
    if (pollTimer.current) clearTimeout(pollTimer.current);
    setActive(null);
    setRecorderVisible(false);
    setInputLevel(0);
    await api.discardRecording(rec.id).catch(() => null);
    void load();
  }, [stream, load]);

  useEffect(
    () => () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
      queue.current?.destroy();
    },
    [],
  );

  const noteForMeeting = useCallback(
    (meetingId: string, occurrenceStart: string) => {
      const at = new Date(occurrenceStart).getTime();
      return notes?.notes.find(
        (n) => n.status === 'Done' && n.scheduledMeetingId === meetingId && n.occurrenceStart && new Date(n.occurrenceStart).getTime() === at,
      );
    },
    [notes],
  );

  const reset = useCallback(() => {
    void discardRecording();
    setNotes(null);
    setError(null);
    setViewingId(null);
    setEditing(null);
  }, [discardRecording]);

  const value = useMemo<NotesContextValue>(
    () => ({
      notes,
      loading,
      error,
      notice,
      clearNotice: () => setNotice(null),
      active,
      inputLevel,
      recorderVisible,
      viewingId,
      editing,
      load,
      startRecording,
      pauseRecording,
      resumeRecording,
      finishRecording,
      discardRecording,
      showRecorder: () => setRecorderVisible(true),
      hideRecorder: () => setRecorderVisible(false),
      openNote: (id: string) => setViewingId(id),
      closeNote: () => setViewingId(null),
      openEditor: (note: EditingNote) => setEditing(note),
      closeEditor: () => {
        setEditing(null);
        void load();
      },
      noteForMeeting,
      reset,
    }),
    [notes, loading, error, notice, active, inputLevel, recorderVisible, viewingId, editing, load, startRecording, pauseRecording, resumeRecording, finishRecording, discardRecording, noteForMeeting, reset],
  );

  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

export function useNotes(): NotesContextValue {
  const ctx = useContext(NotesContext);
  if (!ctx) throw new Error('useNotes must be used inside NotesProvider');
  return ctx;
}
