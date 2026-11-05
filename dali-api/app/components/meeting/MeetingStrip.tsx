import type { ReactNode } from "react";
import { Link } from "react-router";
import { CalendarDays, FileText, Mic, Square, UserCheck } from "lucide-react";
import { AreaTile } from "~/components/shell/AreaTile";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { formatClock } from "~/components/meeting-recorder/transcript";

export type StripRecorder =
  | { phase: "before"; onRecord: () => void }
  | { phase: "recording"; elapsedSeconds: number; onStop?: () => void }
  | { phase: "after"; onTranscript?: () => void; onEnhance?: () => void };

export type StripAttendance = { label: string; onClick?: () => void; to?: string };

const BTN = "h-[38px] rounded-lg px-3.5";

export function MeetingStrip({
  title,
  subtitle,
  attendance,
  recorder,
  noteHref,
  children,
}: {
  title: string;
  subtitle: string;
  attendance: StripAttendance | null;
  recorder: StripRecorder | null;
  noteHref?: string | null;
  children?: ReactNode;
}) {
  const { actionBtn, actionBtnPrimary, actionIcon } = useOsChrome();
  const secondary = cn(actionBtn(), BTN);
  const primary = cn(actionBtnPrimary, BTN);

  const attendanceContent = (
    <>
      <UserCheck className={actionIcon} />
      <span>Attendance</span>
      {attendance && <span className="tabular-nums text-os-grey">{attendance.label}</span>}
    </>
  );

  return (
    <div
      data-testid="meeting-strip"
      className="flex h-[60px] shrink-0 items-center justify-between gap-3 border-b border-os-container bg-os-card px-5"
    >
      <div className="flex min-w-0 items-center gap-3">
        <AreaTile areaKey="calendar" size={32} icon={CalendarDays} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold text-foreground">{title}</span>
          <span data-testid="meeting-strip-subtitle" className="truncate text-xs text-os-grey">
            {subtitle}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {noteHref && (
          <Link to={noteHref} className={secondary}>
            <FileText className={actionIcon} />
            <span>Meeting note</span>
          </Link>
        )}
        {attendance &&
          (attendance.to ? (
            <Link to={attendance.to} className={secondary}>
              {attendanceContent}
            </Link>
          ) : (
            <button type="button" onClick={attendance.onClick} className={secondary}>
              {attendanceContent}
            </button>
          ))}
        {recorder?.phase === "before" && (
          <button type="button" onClick={recorder.onRecord} className={primary}>
            <span aria-hidden className="h-2 w-2 rounded-full bg-os-red" />
            <span>Record</span>
          </button>
        )}
        {recorder?.phase === "recording" && (
          <button
            type="button"
            onClick={recorder.onStop}
            disabled={!recorder.onStop}
            className={cn(
              "inline-flex items-center justify-center gap-2 border border-os-red bg-os-red text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-70",
              BTN,
            )}
          >
            <Square aria-hidden className="h-3 w-3 fill-current" />
            <span>Stop recording</span>
            <span data-testid="meeting-strip-timer" className="tabular-nums">
              {formatClock(recorder.elapsedSeconds)}
            </span>
          </button>
        )}
        {recorder?.phase === "after" && (
          <>
            {recorder.onTranscript && (
              <button type="button" onClick={recorder.onTranscript} className={secondary}>
                <Mic className={actionIcon} />
                <span>Transcript</span>
              </button>
            )}
            {recorder.onEnhance && (
              <button type="button" onClick={recorder.onEnhance} className={primary}>
                <span>Enhance notes</span>
              </button>
            )}
          </>
        )}
        {children}
      </div>
    </div>
  );
}
