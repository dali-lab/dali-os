// Pure "who, if anyone, is recording" lookup over a Hocuspocus/Yjs awareness
// snapshot. The recorder writes { recording: { userId, since } } onto its own
// local state on the document's existing per-room awareness (see
// RecordingPresencePill and MeetingRecorder); BlockNote's own collaboration
// config already puts { user: { name, userId, color } } on that same local
// state (DocEditorImpl's `collaboration.user`), so a client that's recording
// carries both fields at once and no separate name lookup is needed.

export type RecordingAwarenessState = {
  user?: { name?: string };
  recording?: { userId: string; since: number } | null;
};

export type RemoteRecording = { name: string; since: number };

/**
 * The earliest-started remote recorder, or null. Excludes `localClientId` so
 * a client never flags its own recording back at itself — MeetingRecorder
 * already knows its own state.
 */
export function findRemoteRecording(
  states: Map<number, RecordingAwarenessState>,
  localClientId: number,
): RemoteRecording | null {
  let earliest: RemoteRecording | null = null;
  for (const [clientId, state] of states) {
    if (clientId === localClientId) continue;
    const recording = state.recording;
    if (!recording) continue;
    if (!earliest || recording.since < earliest.since) {
      earliest = { name: state.user?.name?.trim() || "Someone", since: recording.since };
    }
  }
  return earliest;
}
