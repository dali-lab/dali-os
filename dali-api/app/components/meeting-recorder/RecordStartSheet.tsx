import { Mic, Monitor } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { Select } from "~/components/ui/floating";
import { Toggle } from "~/components/ui/Toggle";
import { Radio } from "~/components/ui/Radio";
import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import type { UseMeetingRecording } from "./use-meeting-recording";

/**
 * The start sheet: a real decision (source, mic, consent) — the one modal
 * the Recording rail keeps (specs/meeting-recording-rail.md). Shown only
 * while `rec.phase === "idle"`; Start hands off to the rail (the sheet
 * closes, the rail opens) without this component doing anything special —
 * `rec.open` stays true and `rec.phase` simply stops being "idle".
 */
export function RecordStartSheet({ rec }: { rec: UseMeetingRecording }) {
  const open = rec.open && rec.phase === "idle" && rec.canEdit;

  return (
    <Modal
      open={open}
      onClose={rec.cancelStart}
      labelledBy="record-start-sheet-title"
      containerClassName={modalCardClass("max-w-lg")}
    >
      <ModalHeader
        titleId="record-start-sheet-title"
        title="Record this meeting"
        onClose={rec.cancelStart}
        className="mb-4"
      />

      <div className="flex flex-col gap-4">
        {rec.desktopVer != null && (
          <div
            className={cn(
              "rounded-xl border px-3 py-2.5",
              rec.useDesktopApp ? "border-os-accent bg-os-accent/10" : "border-os-container",
            )}
          >
            <Radio
              name="capture-mode"
              checked={rec.useDesktopApp}
              onChange={() => rec.setUseDesktopApp(true)}
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Monitor className="h-3.5 w-3.5" /> Capture everything on this Mac with the DALI OS app
                </span>
              }
              description="Records system audio (everyone on the call) and your mic."
            />
          </div>
        )}
        {rec.desktopVer != null && (
          <div
            className={cn(
              "rounded-xl border px-3 py-2.5",
              !rec.useDesktopApp ? "border-os-accent bg-os-accent/10" : "border-os-container",
            )}
          >
            <Radio
              name="capture-mode"
              checked={!rec.useDesktopApp}
              onChange={() => rec.setUseDesktopApp(false)}
              label="Record in this browser instead"
            />
          </div>
        )}

        {!rec.useDesktopApp && (
          <div className="flex flex-col gap-3 rounded-xl bg-os-well p-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Microphone</span>
              {rec.micPreviewError ? (
                <p className="text-xs text-red-700">{rec.micPreviewError}</p>
              ) : (
                <div className="flex items-center gap-2">
                  <Select
                    value={rec.micDeviceId}
                    onChange={rec.setMicDeviceId}
                    options={rec.micOptions}
                    placeholder="Default microphone"
                    ariaLabel="Microphone"
                  />
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-os-container">
                    <div
                      className="h-full rounded-full bg-os-accent transition-[width]"
                      style={{ width: `${Math.round(rec.micLevel * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
            {rec.desktopVer == null &&
              (rec.callAudioUnsupported ? (
                <p className="text-xs text-muted-foreground">
                  This browser can't capture call audio; the recording will use your microphone only.
                </p>
              ) : (
                <Toggle
                  checked={rec.callAudioWanted}
                  onChange={(e) => rec.setCallAudioWanted(e.target.checked)}
                  label="Include call audio from a browser tab"
                  description="Shares a tab, window, or screen; only the audio is kept."
                />
              ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Everyone in the meeting should know it's being recorded. A recording badge shows on this note while it
          runs. Don't record meetings where patient, student record, or other protected information will be
          discussed.
        </p>
        <p className="text-xs text-muted-foreground">
          Enhance sends your typed notes and the transcript to the AI provider.
        </p>

        {rec.error && <p className="text-xs text-red-700">{rec.error}</p>}
      </div>

      <div className="mt-5 flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={() => void (rec.useDesktopApp ? rec.startDesktop() : rec.startBrowser())}
          className={buttonClasses("primary", "sm")}
        >
          <Mic className="h-3.5 w-3.5" /> Start recording
        </button>
      </div>
    </Modal>
  );
}
