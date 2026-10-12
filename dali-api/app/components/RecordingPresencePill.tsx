import { useEffect, useState } from "react";
import { acquireCollabDoc, releaseCollabDoc } from "~/components/doc/collab-doc";
import { findRemoteRecording, type RecordingAwarenessState } from "./meeting-recorder/awareness";

/**
 * Red "Recording · <name>" pill shown to EVERY viewer of a note while
 * someone (owner or not, browser or desktop) is recording it — the consent
 * signal from specs/meeting-transcription.md. Joins the same per-document
 * Hocuspocus awareness room DocEditorImpl already opens for this
 * documentName (acquireCollabDoc is refcounted, so this never opens a
 * second socket) and reads the `recording` field MeetingRecorder sets on
 * its own local state there.
 */
export function RecordingPresencePill({
  documentName,
  collabToken,
}: {
  documentName: string;
  collabToken: string | null | undefined;
}) {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (!collabToken) return;
    const entry = acquireCollabDoc(documentName, collabToken);
    const awareness = entry.provider.awareness;
    if (!awareness) {
      releaseCollabDoc(documentName);
      return;
    }
    const update = () => {
      const states = awareness.getStates() as Map<number, RecordingAwarenessState>;
      const remote = findRemoteRecording(states, entry.ydoc.clientID);
      setName(remote?.name ?? null);
    };
    awareness.on("change", update);
    update();
    return () => {
      awareness.off("change", update);
      releaseCollabDoc(documentName);
    };
  }, [documentName, collabToken]);

  if (!name) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1.5 text-sm font-medium text-red-800">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-600" />
      Recording · {name}
    </span>
  );
}
