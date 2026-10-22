import type { ReactNode } from "react";
import { useMeetingRecording, type UseMeetingRecording, type UseMeetingRecordingProps } from "./use-meeting-recording";

// Mounts useMeetingRecording() only while `enabled` is true — the feature
// flag, a recording policy or canShowRecorder could each flip false
// mid-session (e.g. a followed `?transcript=` recording gets discarded,
// dropping the URL param), so the hook can't be called conditionally inside
// one stable component; mounting/unmounting this one instead keeps every call
// to the rules of hooks.
export function RecordingMount({
  enabled,
  children,
  ...hookProps
}: UseMeetingRecordingProps & { enabled: boolean; children: (rec: UseMeetingRecording | null) => ReactNode }) {
  if (!enabled) return <>{children(null)}</>;
  // Keyed by documentName: a route can swap the note it shows (notebook tabs)
  // on an otherwise-still-mounted tree. Without the key, the hook's state
  // would carry over from the old note instead of resetting to idle.
  return (
    <RecordingMountInner key={hookProps.documentName} {...hookProps}>
      {children}
    </RecordingMountInner>
  );
}

function RecordingMountInner({
  children,
  ...hookProps
}: UseMeetingRecordingProps & { children: (rec: UseMeetingRecording) => ReactNode }) {
  const rec = useMeetingRecording(hookProps);
  return <>{children(rec)}</>;
}
