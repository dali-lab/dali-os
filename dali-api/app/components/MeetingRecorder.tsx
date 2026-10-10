import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Mic, Monitor, Square, Trash2 } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { Select, Tooltip, type SelectOption } from "~/components/ui/floating";
import { Toggle } from "~/components/ui/Toggle";
import { Radio } from "~/components/ui/Radio";
import { Checkbox } from "~/components/ui/Checkbox";
import { DateField } from "~/components/ui/DateField";
import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import {
  formatDateTime,
  formatIsoDate,
  useMeetingRecording,
  type CaptureMode,
  type UseMeetingRecordingProps,
} from "./meeting-recorder/use-meeting-recording";
import { formatClock, speakerLabelFor } from "./meeting-recorder/transcript";
import { applyEnhancePlan, type SnapshotBlock, type StoredEnhanceNotes } from "./meeting-recorder/enhance-plan";
import { isUntouchedTemplate } from "~/lib/meeting-note-template";
import type { Channel, RosterUser } from "./meeting-recorder/types";

/**
 * The Record button in a Drive document's top bar. A sheet picks the
 * capture source (this browser's mic/call audio, or "everything on this
 * Mac" via the DALI OS desktop app); while live it's a pill with a timer and
 * level meter; on stop the transcript is batch-processed server-side
 * (Parakeet + pyannote on Modal) and the page polls until it's done, then
 * shows You/Others + diarized speaker chips, renameable to the occurrence
 * roster. See specs/meeting-transcription.md.
 *
 * The state machine, fetches, polling, capture, backup, and open/setOpen
 * live in useMeetingRecording (specs/meeting-recording-rail.md); this
 * component is the rendering for all of it.
 */
export function MeetingRecorder(props: UseMeetingRecordingProps) {
  const { actionBtnPrimary, actionIcon } = useOsChrome();
  const rec = useMeetingRecording(props);

  if (!rec.canShowRecorder) return null;

  const triggerLabel =
    rec.phase === "idle"
      ? rec.canEdit
        ? "Record"
        : "Transcript"
      : rec.remote && !rec.remote.ownerIsYou && (rec.phase === "recording" || rec.phase === "starting" || rec.phase === "stopping")
        ? `Recording · ${rec.remote.ownerName}`
        : "Show recording";

  return (
    <>
      <Tooltip content={triggerLabel}>
        <button
          type="button"
          onClick={() => rec.setOpen(true)}
          aria-label={triggerLabel}
          className={cn(
            actionBtnPrimary,
            (rec.phase === "recording" || rec.phase === "stopping") &&
              "border-accent-coral bg-accent-coral text-navy-deep hover:border-accent-coral-light hover:bg-accent-coral-light",
          )}
        >
          <Mic className={actionIcon} />
          {rec.phase === "idle" ? (
            <span className="hidden sm:inline">{triggerLabel}</span>
          ) : rec.phase === "recording" ? (
            <>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              {formatClock(rec.elapsed)}
              {rec.remote && !rec.remote.ownerIsYou && <span className="hidden sm:inline">· {rec.remote.ownerName}</span>}
            </>
          ) : (
            <span className="hidden sm:inline">{triggerLabel}</span>
          )}
        </button>
      </Tooltip>

      <Modal
        open={rec.open}
        onClose={() => rec.setOpen(false)}
        labelledBy="meeting-recorder-title"
        containerClassName={modalCardClass("max-w-lg")}
      >
        <ModalHeader
          titleId="meeting-recorder-title"
          title={
            rec.phase === "idle"
              ? "Record this meeting"
              : rec.phase === "recording"
                ? "Recording"
                : rec.phase === "processing"
                  ? "Transcribing"
                  : rec.phase === "done"
                    ? "Transcript"
                    : rec.phase === "failed"
                      ? "Recording failed"
                      : "Recording"
          }
          subtitle={statusLineFor(rec)}
          onClose={() => rec.setOpen(false)}
          className="mb-4"
        />

        {rec.phase === "idle" && rec.canEdit && (
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
              Type rough notes during the meeting; Enhance fills them in afterwards.
            </p>
          </div>
        )}

        {rec.remote && (rec.phase === "starting" || rec.phase === "recording" || rec.phase === "stopping") && (
          <p className="mb-3 rounded-xl bg-os-well px-3 py-3 text-sm text-foreground">
            {rec.remote.ownerIsYou
              ? "You're recording this meeting from another device. The transcript appears here when it's done."
              : `${rec.remote.ownerName} is recording this meeting. The transcript appears here when it's done.`}
          </p>
        )}
        {rec.stopStuck && rec.drives && (
          <p className="mb-3 rounded-xl bg-os-well px-3 py-3 text-sm text-foreground">
            The app may have quit before it finished uploading. Transcribe what reached the server, or discard the recording.
          </p>
        )}
        {(rec.phase === "starting" || rec.phase === "recording" || rec.phase === "stopping") && (
          <RecordingLiveBody
            captureMode={rec.captureMode}
            channelsActive={rec.channelsActive}
            levels={rec.levels}
            stalled={rec.stalled}
            appUnreachable={rec.appUnreachable && rec.phase === "starting"}
          />
        )}

        {rec.phase === "review" && (
          <div className="flex flex-col gap-2 rounded-xl bg-os-well px-3 py-3 text-sm text-foreground">
            <p>
              {rec.remote && !rec.remote.ownerIsYou
                ? `${rec.remote.ownerName} stopped the recording. The transcript appears here once they finish it.`
                : "Stopped. Add another session, or finish to transcribe what was recorded."}
            </p>
          </div>
        )}

        {rec.phase === "processing" && (
          <p className="rounded-xl bg-os-well px-3 py-3 text-sm text-muted-foreground">
            Transcribing and labeling speakers, usually a few minutes.
          </p>
        )}

        {(rec.phase === "done" || rec.phase === "failed") && (
          <div className="flex flex-col gap-3">
            {rec.phase === "failed" ? (
              <p className="text-sm text-red-700">{rec.error ?? "Transcription failed. Try recording again."}</p>
            ) : (
              <>
                {rec.insertedAt && (
                  <p className="text-xs text-muted-foreground">Already in this note. Discarding only removes the recording, not what was inserted.</p>
                )}
                {rec.enhancedAt && (
                  <p className="text-xs text-muted-foreground">
                    Enhanced {formatDateTime(rec.enhancedAt)}{rec.enhancedByName ? ` by ${rec.enhancedByName}` : ""}. Enhance
                    again rebuilds the notes from the current text and the transcript.
                  </p>
                )}
                {rec.hasTranscript && rec.speakerKeys.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {rec.speakerKeys.map((key) => (
                      <SpeakerChip
                        key={key}
                        speakerKey={key}
                        lines={rec.lines}
                        speakerCounts={rec.speakerCounts}
                        speakers={rec.speakers}
                        roster={rec.roster}
                        canEdit={rec.canEdit}
                        onRename={() => void rec.renameSpeaker(key)}
                      />
                    ))}
                  </div>
                )}
                <div className="max-h-72 overflow-y-auto rounded-xl bg-os-well px-3 py-2 text-sm leading-relaxed">
                  {!rec.hasTranscript ? (
                    <p className="text-muted-foreground">Nothing was transcribed.</p>
                  ) : (
                    rec.sortedLines.map((l, i) => (
                      <p
                        key={i}
                        ref={i === rec.highlightLineIndex ? rec.highlightLineRef : undefined}
                        className={cn(
                          "scroll-mt-2 rounded px-1 -mx-1",
                          i === rec.highlightLineIndex ? "bg-os-accent/15 text-foreground" : "text-foreground",
                        )}
                      >
                        <span className="mr-2 font-mono text-[11px] text-muted-foreground">{formatClock(l.at)}</span>
                        <span className="mr-1 font-medium text-muted-foreground">
                          {speakerLabelFor(l, rec.speakerCounts, rec.speakers, rec.roster)}:
                        </span>
                        {l.text}
                      </p>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {rec.error && rec.phase !== "failed" && <p className="mt-2 text-xs text-red-700">{rec.error}</p>}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-1.5">
          {rec.phase === "idle" && rec.canEdit && (
            <button
              type="button"
              onClick={() => void (rec.useDesktopApp ? rec.startDesktop() : rec.startBrowser())}
              className={buttonClasses("primary", "sm")}
            >
              <Mic className="h-3.5 w-3.5" /> Start recording
            </button>
          )}
          {rec.phase === "starting" && rec.appUnreachable && (
            <>
              <IconButton label="Cancel" icon={Trash2} tone="destructive" onClick={rec.cancelStart} />
              <a href="/download" className={buttonClasses("secondary", "sm")}>
                <Download className="h-3.5 w-3.5" /> Get the app
              </a>
              <button
                type="button"
                onClick={rec.switchToBrowserAfterUnreachable}
                className={buttonClasses("primary", "sm")}
              >
                Record in this browser instead
              </button>
            </>
          )}
          {rec.phase === "starting" && !rec.appUnreachable && rec.drives && (
            <button type="button" onClick={rec.cancelStart} className={buttonClasses("secondary", "sm")}>
              Cancel
            </button>
          )}
          {(rec.phase === "recording" || rec.phase === "stopping") && rec.drives && !rec.stopStuck && (
            <button
              type="button"
              onClick={() => void rec.stop()}
              disabled={rec.phase === "stopping"}
              className={buttonClasses("secondary", "sm")}
            >
              <Square className="h-3 w-3 fill-current" /> Stop
            </button>
          )}
          {rec.stopStuck && rec.drives && (
            <>
              <IconButton label="Discard recording" icon={Trash2} tone="destructive" onClick={() => void rec.discard()} />
              <button type="button" onClick={() => void rec.finishAndTranscribe()} className={buttonClasses("primary", "sm")}>
                Transcribe anyway
              </button>
            </>
          )}
          {rec.phase === "processing" && rec.canDiscard && (
            <IconButton label="Discard recording" icon={Trash2} tone="destructive" onClick={() => void rec.discard()} />
          )}
          {rec.phase === "review" && rec.canEdit && rec.drives && (
            <>
              <IconButton label="Discard recording" icon={Trash2} tone="destructive" onClick={() => void rec.discard()} />
              <button type="button" onClick={() => void rec.resume()} className={buttonClasses("secondary", "sm")}>
                <Mic className="h-3.5 w-3.5" /> Continue
              </button>
              <button type="button" onClick={() => void rec.finishAndTranscribe()} className={buttonClasses("primary", "sm")}>
                Transcribe
              </button>
            </>
          )}
          {rec.phase === "done" && rec.canEdit && (
            <>
              {rec.canDiscard && (
                <IconButton
                  label="Discard recording"
                  icon={Trash2}
                  tone="destructive"
                  onClick={() => void rec.discard()}
                  disabled={rec.busy}
                />
              )}
              {rec.aiEnabled && rec.hasTranscript && !rec.insertedAt && (
                <button
                  type="button"
                  onClick={() => rec.insert(null)}
                  disabled={rec.busy}
                  className={buttonClasses("secondary", "sm")}
                >
                  Insert transcript
                </button>
              )}
              {!rec.insertedAt && (
                <button
                  type="button"
                  onClick={
                    !rec.aiEnabled
                      ? () => rec.insert(null)
                      : () => void rec.onEnhanceClick(Boolean(rec.enhancedAt))
                  }
                  disabled={!rec.hasTranscript || rec.busy}
                  className={buttonClasses("primary", "sm")}
                >
                  {!rec.aiEnabled
                    ? "Insert transcript"
                    : rec.enhancedAt
                      ? "Enhance again"
                      : rec.currentlyUntouched()
                        ? "Write notes"
                        : "Enhance notes"}
                </button>
              )}
            </>
          )}
          {rec.phase === "failed" && rec.canEdit && (
            <>
              {rec.canDiscard && (
                <IconButton label="Discard recording" icon={Trash2} tone="destructive" onClick={() => void rec.discard()} />
              )}
              {rec.drives && !rec.finalized && (
                <button type="button" onClick={() => void rec.retryProcessing()} className={buttonClasses("primary", "sm")}>
                  Try again
                </button>
              )}
            </>
          )}
        </div>
      </Modal>

      <EnhanceSheet
        open={rec.enhanceSheetOpen}
        onClose={() => rec.setEnhanceSheetOpen(false)}
        notes={rec.enhanceNotes}
        busy={rec.enhanceBusy}
        applyBusy={rec.applyBusy}
        error={rec.enhanceError}
        getNoteState={rec.getNoteState}
        seededFromPageId={rec.seededFromPageId}
        seededTemplateHash={rec.seededTemplateHash}
        onApply={() => void rec.applyEnhance()}
        roster={rec.roster}
        projectId={rec.projectId}
        canCreateTasks={rec.canCreateTasks}
        onCreateTasks={rec.createTasksFromItems}
      />
    </>
  );
}

function statusLineFor(rec: ReturnType<typeof useMeetingRecording>) {
  const { phase, captureMode, appUnreachable, elapsed, remote, stopStuck, recordedSeconds, lines } = rec;
  return phase === "idle"
    ? null
    : phase === "starting"
      ? captureMode === "desktop"
        ? appUnreachable
          ? "The DALI OS app didn't respond."
          : "Opening the DALI OS app…"
        : "Starting…"
      : phase === "recording"
        ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              {formatClock(elapsed)}
              {remote && <span className="text-muted-foreground">· {remote.ownerIsYou ? "another device" : remote.ownerName}</span>}
            </span>
          )
        : phase === "stopping"
          ? stopStuck
            ? "The DALI OS app hasn't confirmed the stop."
            : "Stopping…"
          : phase === "review"
            ? `${formatClock(recordedSeconds)} recorded`
            : phase === "processing"
              ? "Transcribing…"
              : phase === "done"
                ? `${formatClock(Math.max(recordedSeconds, ...lines.map((l) => l.end), 0))} recorded`
                : "Recording failed";
}

function SpeakerChip({
  speakerKey,
  lines,
  speakerCounts,
  speakers,
  roster,
  canEdit,
  onRename,
}: {
  speakerKey: string;
  lines: ReturnType<typeof useMeetingRecording>["lines"];
  speakerCounts: ReturnType<typeof useMeetingRecording>["speakerCounts"];
  speakers: ReturnType<typeof useMeetingRecording>["speakers"];
  roster: RosterUser[];
  canEdit: boolean;
  onRename: () => void;
}) {
  const line = lines.find((l) => l.speaker === speakerKey);
  const label = line ? speakerLabelFor(line, speakerCounts, speakers, roster) : speakerKey;
  if (!canEdit) return <span className="rounded-full bg-os-container px-2 py-0.5 text-xs">{label}</span>;
  return (
    <button
      type="button"
      onClick={onRename}
      className="rounded-full border border-os-container px-2 py-0.5 text-xs text-foreground hover:border-os-container-hi"
    >
      {label}
    </button>
  );
}

/**
 * Read-only preview of Enhance's merge (specs/meeting-notes-model.md §2):
 * changed and added blocks, the skipped-conflicts and dropped-citation
 * counts, and the action items list (owner + due, read-only — creating tasks
 * from them is PR 3 of the spec, not this one). Recomputes the merge fresh
 * from the live editor each time it opens, via getNoteState.
 */
type ActionItemRowState = { checked: boolean; ownerUserId: string; dueAt: string };

function EnhanceSheet({
  open,
  onClose,
  notes,
  busy,
  applyBusy,
  error,
  getNoteState,
  seededFromPageId,
  seededTemplateHash,
  onApply,
  roster = [],
  projectId = null,
  canCreateTasks = false,
  onCreateTasks,
}: {
  open: boolean;
  onClose: () => void;
  notes: StoredEnhanceNotes | null;
  busy: boolean;
  applyBusy: boolean;
  error: string | null;
  getNoteState?: () => { blocks: SnapshotBlock[]; bodyText: string } | null;
  seededFromPageId: string | null;
  seededTemplateHash: string | null;
  onApply: () => void;
  /** The occurrence roster, for the owner picker. */
  roster?: RosterUser[];
  projectId?: string | null;
  canCreateTasks?: boolean;
  onCreateTasks?: (
    items: { index: number; title: string; assigneeId?: string; dueAt?: string }[],
  ) => Promise<boolean>;
}) {
  const preview = useMemo(() => {
    if (!open || !notes || !getNoteState) return null;
    const state = getNoteState();
    if (!state) return null;
    const untouchedTemplate = isUntouchedTemplate({ seededFromPageId, seededTemplateHash }, state.bodyText);
    return applyEnhancePlan(notes.snapshot, state.blocks, notes.plan, { untouchedTemplate });
  }, [open, notes, getNoteState, seededFromPageId, seededTemplateHash]);

  const changed = preview?.ops.filter((op) => op.kind === "update") ?? [];
  const added = preview?.ops.filter((op) => op.kind === "insertAfter") ?? [];

  // Action items into Tasks (specs/meeting-notes-model.md §4): one editable
  // row per item, pre-checked, owner/due pre-filled from the verified plan.
  // Re-seeded only when a genuinely new plan lands (snapshotAt changes) —
  // Create tasks writes `taskId` back into `notes` in place, which must not
  // reset anyone's in-progress owner/due edits.
  const [itemState, setItemState] = useState<Record<number, ActionItemRowState>>({});
  const [createTasksBusy, setCreateTasksBusy] = useState(false);
  const seededSnapshotAt = useRef<string | null>(null);
  useEffect(() => {
    if (!notes) {
      seededSnapshotAt.current = null;
      setItemState({});
      return;
    }
    if (seededSnapshotAt.current === notes.snapshotAt) return;
    seededSnapshotAt.current = notes.snapshotAt;
    const next: Record<number, ActionItemRowState> = {};
    notes.plan.actionItems.forEach((item, i) => {
      next[i] = { checked: true, ownerUserId: item.ownerUserId ?? "", dueAt: item.due ?? "" };
    });
    setItemState(next);
  }, [notes]);

  // The plan's own roster (occurrence attendance + the note's project
  // current-term members, specs/meeting-notes-model.md §6) is more complete
  // than the page's occurrence-only roster prop — fall back to the prop only
  // for a plan stored before that field existed.
  const rosterForOwners = notes?.roster?.length ? notes.roster : roster;
  const ownerOptions: SelectOption[] = [
    { value: "", label: "Unassigned" },
    ...rosterForOwners.map((r) => ({ value: r.userId, label: r.name })),
  ];

  async function handleCreateTasks() {
    if (!notes || !onCreateTasks) return;
    const items = notes.plan.actionItems
      .map((item, index) => ({ item, index, row: itemState[index] }))
      .filter(({ item, row }) => row?.checked && !item.taskId)
      .map(({ item, index, row }) => ({
        index,
        title: item.text,
        assigneeId: row!.ownerUserId || undefined,
        dueAt: row!.dueAt ? new Date(row!.dueAt).toISOString() : undefined,
      }));
    if (items.length === 0) return;
    setCreateTasksBusy(true);
    try {
      await onCreateTasks(items);
    } finally {
      setCreateTasksBusy(false);
    }
  }

  const pendingActionItems = notes?.plan.actionItems.filter((item) => !item.taskId).length ?? 0;
  const showCreateTasks = Boolean(canCreateTasks && projectId && pendingActionItems > 0);

  return (
    <Modal open={open} onClose={onClose} labelledBy="enhance-sheet-title" containerClassName={modalCardClass("max-w-2xl")}>
      <ModalHeader titleId="enhance-sheet-title" title="Enhance preview" onClose={onClose} className="mb-4" />

      {busy && !notes && <p className="text-sm text-muted-foreground">Generating…</p>}
      {error && !notes && <p className="text-sm text-red-700">{error}</p>}

      {notes && (
        <div className="flex flex-col gap-4">
          {(preview?.skipped ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground">
              {preview!.skipped} block{preview!.skipped === 1 ? "" : "s"} changed while this ran and were left as
              typed.
            </p>
          )}
          {(notes.verified.droppedBlocks > 0 || notes.verified.droppedCites > 0) && (
            <p className="text-xs text-muted-foreground">
              {notes.verified.droppedBlocks > 0 &&
                `${notes.verified.droppedBlocks} addition${notes.verified.droppedBlocks === 1 ? "" : "s"} couldn't be verified against the transcript and were left out. `}
              {notes.verified.droppedCites > 0 &&
                `${notes.verified.droppedCites} citation${notes.verified.droppedCites === 1 ? "" : "s"} didn't match the transcript and were dropped.`}
            </p>
          )}

          <div className="flex max-h-[45vh] flex-col gap-2 overflow-y-auto rounded-xl bg-os-well px-3 py-3">
            {changed.length === 0 && added.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing to change.</p>
            ) : (
              <>
                {changed.map(
                  (op) =>
                    op.kind === "update" && <EnhanceOpRow key={op.id} label="Changed" text={op.text} cites={op.cites} />,
                )}
                {added.map(
                  (op, i) =>
                    op.kind === "insertAfter" &&
                    op.blocks.map((b, j) => (
                      <EnhanceOpRow key={`${i}-${j}`} label="Added" text={b.text} cites={b.cites} />
                    )),
                )}
              </>
            )}
          </div>

          {notes.plan.actionItems.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">Action items</p>
                {showCreateTasks && (
                  <button
                    type="button"
                    onClick={() => void handleCreateTasks()}
                    disabled={createTasksBusy}
                    className={buttonClasses("secondary", "sm")}
                  >
                    {createTasksBusy ? "Creating…" : "Create tasks"}
                  </button>
                )}
              </div>
              <ul className="flex flex-col gap-2">
                {notes.plan.actionItems.map((item, i) => {
                  const row = itemState[i];
                  if (item.taskId) {
                    return (
                      <li key={i} className="flex flex-col gap-1 rounded-lg bg-os-well px-3 py-2 text-sm text-foreground">
                        <p>{item.text}</p>
                        <p className="text-xs text-muted-foreground">
                          Task created
                          {projectId && (
                            <>
                              {" · "}
                              <a
                                href={`/projects/${projectId}?tab=progress&task=${item.taskId}`}
                                className="text-os-accent underline"
                              >
                                View task
                              </a>
                            </>
                          )}
                        </p>
                      </li>
                    );
                  }
                  if (!showCreateTasks) {
                    return (
                      <li key={i} className="rounded-lg bg-os-well px-3 py-2 text-sm text-foreground">
                        <p>{item.text}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.ownerName
                            ? item.ownerUserId
                              ? item.ownerName
                              : `${item.ownerName}: no match on the roster`
                            : "Unassigned"}
                          {item.due && ` · ${formatIsoDate(item.due)}${item.dueSource ? ` (${item.dueSource})` : ""}`}
                        </p>
                      </li>
                    );
                  }
                  return (
                    <li key={i} className="flex flex-col gap-2 rounded-lg bg-os-well px-3 py-2 text-sm text-foreground">
                      <div className="flex items-start gap-2">
                        <Checkbox
                          tone="os"
                          checked={row?.checked ?? true}
                          onChange={(e) =>
                            setItemState((s) => ({
                              ...s,
                              [i]: { ...(s[i] ?? { ownerUserId: "", dueAt: "" }), checked: e.target.checked },
                            }))
                          }
                        />
                        <p className="flex-1">{item.text}</p>
                      </div>
                      <div className="flex flex-wrap items-start gap-3 pl-6">
                        <div className="flex flex-col gap-1">
                          <Select
                            value={row?.ownerUserId ?? ""}
                            onChange={(value) =>
                              setItemState((s) => ({
                                ...s,
                                [i]: { ...(s[i] ?? { checked: true, dueAt: "" }), ownerUserId: value },
                              }))
                            }
                            options={ownerOptions}
                            ariaLabel="Owner"
                          />
                          {item.ownerName && !item.ownerUserId && (
                            <span className="text-[11px] text-muted-foreground">{item.ownerName}: no match on the roster</span>
                          )}
                        </div>
                        <div className="flex flex-col gap-1">
                          <DateField
                            mode="date"
                            value={row?.dueAt ?? ""}
                            onChange={(value) =>
                              setItemState((s) => ({
                                ...s,
                                [i]: { ...(s[i] ?? { checked: true, ownerUserId: "" }), dueAt: value },
                              }))
                            }
                            ariaLabel="Due date"
                          />
                          {item.dueSource && (
                            <span className="text-[11px] text-muted-foreground">from &quot;{item.dueSource}&quot;</span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {error && <p className="text-xs text-red-700">{error}</p>}
        </div>
      )}

      <div className="mt-5 flex items-center justify-end gap-1.5">
        <button type="button" onClick={onClose} className={buttonClasses("secondary", "sm")}>
          Cancel
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={!notes || busy || applyBusy}
          className={buttonClasses("primary", "sm")}
        >
          {applyBusy ? "Applying…" : "Apply"}
        </button>
      </div>
    </Modal>
  );
}

function EnhanceOpRow({ label, text, cites }: { label: "Changed" | "Added"; text: string; cites: number[] }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-os-container bg-background px-3 py-2">
      <span
        className={cn(
          "self-start rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
          label === "Added" ? "bg-os-accent/15 text-os-accent" : "bg-os-container text-muted-foreground",
        )}
      >
        {label}
      </span>
      <p className="text-sm text-foreground">
        {text}
        {cites.map((c) => (
          <span key={c} className="ml-1.5 rounded-full bg-os-accent/10 px-1.5 py-0.5 font-mono text-[11px] text-os-accent">
            {formatClock(c)}
          </span>
        ))}
      </p>
    </div>
  );
}

function RecordingLiveBody({
  captureMode,
  channelsActive,
  levels,
  stalled,
  appUnreachable,
}: {
  captureMode: CaptureMode;
  channelsActive: Channel[];
  levels: Record<Channel, number>;
  stalled: Record<Channel, boolean>;
  appUnreachable: boolean;
}) {
  if (appUnreachable) {
    return (
      <p className="rounded-xl bg-os-well px-3 py-3 text-sm text-foreground">
        Update the DALI OS app to record, or record in this browser instead.
      </p>
    );
  }
  const channelLabel: Record<Channel, string> = { mic: "Microphone", call: "Call audio" };
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-os-well px-3 py-3">
      <p className="text-sm text-foreground">
        Recording. The transcript appears a few minutes after you stop.
      </p>
      {captureMode === "browser" && channelsActive.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {channelsActive.map((ch) => (
            <li key={ch} className="flex items-center gap-2 text-sm">
              <span className="w-24 shrink-0 text-muted-foreground">{channelLabel[ch]}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-os-container">
                <div
                  className="h-full rounded-full bg-os-accent transition-[width]"
                  style={{ width: `${Math.round((levels[ch] ?? 0) * 100)}%` }}
                />
              </div>
              {stalled[ch] && <span className="text-xs text-red-700">Upload stalled</span>}
            </li>
          ))}
        </ul>
      )}
      {captureMode === "desktop" && (
        <p className="text-xs text-muted-foreground">Recording via the DALI OS app.</p>
      )}
    </div>
  );
}
