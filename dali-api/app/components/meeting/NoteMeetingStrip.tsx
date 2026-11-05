import { useState } from "react";
import { useRevalidator } from "react-router";
import { AttendanceChecklist, type AttendanceRow } from "~/components/AttendanceChecklist";
import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { RecordStartSheet } from "~/components/meeting-recorder/RecordStartSheet";
import type { UseMeetingRecording } from "~/components/meeting-recorder/use-meeting-recording";
import { MeetingStrip, type StripRecorder } from "./MeetingStrip";
import { attendanceLabel, meetingPlaceLabel, meetingSubtitle, type MeetingStripSource } from "./meeting-strip-model";

export type NoteStripAttendance = {
  meetingId: string;
  occurrenceStart: string;
  meetingLabel: string;
  canMark: boolean;
  walletConfigured: boolean;
  rows: AttendanceRow[];
};

export function stripRecorderFor(rec: UseMeetingRecording | null): StripRecorder | null {
  if (!rec || !rec.canShowRecorder) return null;
  const live = rec.phase === "starting" || rec.phase === "recording" || rec.phase === "stopping";
  if (live) {
    return {
      phase: "recording",
      elapsedSeconds: rec.elapsed,
      onStop: rec.drives && rec.phase === "recording" ? () => void rec.stop() : undefined,
    };
  }
  if (rec.phase === "idle") return rec.canEdit ? { phase: "before", onRecord: () => rec.setOpen(true) } : null;
  return {
    phase: "after",
    onTranscript: () => rec.setOpen(true),
    onEnhance:
      rec.canEdit && rec.hasTranscript && rec.aiEnabled && !rec.enhancedAt ? () => void rec.enhanceNow() : undefined,
  };
}

export function NoteMeetingStrip({
  title,
  source,
  attendance,
  rec,
}: {
  title: string;
  source: MeetingStripSource;
  attendance: NoteStripAttendance;
  rec: UseMeetingRecording | null;
}) {
  const revalidator = useRevalidator();
  const [open, setOpen] = useState(false);
  const recorder = stripRecorderFor(rec);
  const recordedMinutes =
    recorder?.phase === "after" && rec ? Math.max(1, Math.round(rec.recordedSeconds / 60)) : null;
  const close = () => {
    setOpen(false);
    revalidator.revalidate();
  };
  return (
    <MeetingStrip
      title={title}
      subtitle={meetingSubtitle({ startIso: source.startIso, place: meetingPlaceLabel(source), recordedMinutes })}
      attendance={{ label: attendanceLabel(attendance.rows), onClick: () => setOpen(true) }}
      recorder={recorder}
    >
      <Modal
        open={open}
        onClose={close}
        labelledBy="doc-attendance-title"
        containerClassName={modalCardClass("max-w-4xl")}
      >
        <ModalHeader
          titleId="doc-attendance-title"
          title="Attendance"
          subtitle={attendance.meetingLabel}
          onClose={close}
          className="mb-1"
        />
        <AttendanceChecklist
          plain
          meetingId={attendance.meetingId}
          occurrenceStart={attendance.occurrenceStart}
          meetingLabel={attendance.meetingLabel}
          canEdit={attendance.canMark}
          canScan={attendance.walletConfigured}
          attendees={attendance.rows}
        />
      </Modal>
      {rec && <RecordStartSheet rec={rec} />}
    </MeetingStrip>
  );
}
