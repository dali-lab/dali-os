// Held outside React so the "Recording · <name>" signal outlives the note's
// route, the same way live-session.ts keeps capture running after you leave.

import { acquireCollabDoc, releaseCollabDoc } from "~/components/doc/collab-doc";
import { getLiveSession, subscribeLiveSession } from "./live-session";

type Held = {
  recordingId: string;
  documentName: string;
  awareness: { setLocalStateField: (field: string, value: unknown) => void };
  seenLive: boolean;
  unsubscribe: () => void;
};

let held: Held | null = null;

export function holdRecordingPresence(opts: { recordingId: string; documentName: string; collabToken: string }) {
  if (held?.recordingId === opts.recordingId && held.documentName === opts.documentName) return;
  releaseRecordingPresence();
  const entry = acquireCollabDoc(opts.documentName, opts.collabToken);
  const awareness = entry.provider.awareness;
  if (!awareness) {
    releaseCollabDoc(opts.documentName);
    return;
  }
  const localUser = awareness.getLocalState()?.user as { userId?: string } | undefined;
  awareness.setLocalStateField("recording", {
    userId: localUser?.userId ?? "",
    since: Date.now(),
    recordingId: opts.recordingId,
  });
  const current: Held = {
    recordingId: opts.recordingId,
    documentName: opts.documentName,
    awareness,
    seenLive: false,
    unsubscribe: () => {},
  };
  held = current;
  const check = () => {
    if (held !== current) return;
    const session = getLiveSession();
    if (session?.recordingId === current.recordingId) {
      if (session.status === "stopped") releaseRecordingPresence(current.recordingId);
      else current.seenLive = true;
      return;
    }
    // A hold can start before the store has reconciled this recording, so only
    // its disappearance after being seen counts as the end.
    if (current.seenLive) releaseRecordingPresence(current.recordingId);
  };
  current.unsubscribe = subscribeLiveSession(check);
  check();
}

/** Clears the signal; with an id, only when that recording is the one held. */
export function releaseRecordingPresence(recordingId?: string) {
  const current = held;
  if (!current || (recordingId && current.recordingId !== recordingId)) return;
  held = null;
  current.unsubscribe();
  current.awareness.setLocalStateField("recording", null);
  releaseCollabDoc(current.documentName);
}
