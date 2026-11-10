import { FloatingPortal, autoUpdate, offset, size, useFloating } from "@floating-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buttonClasses } from "~/components/ui/Button";
import { Combobox, isInFloatingLayer, type SelectOption } from "~/components/ui/floating";
import { useToast } from "~/components/ui/toast";
import {
  TASK_CHIP_CLASS,
  TASK_CHIP_REQUIRED_CLASS,
  TaskDueChip,
  TaskOwnerChip,
  TaskStatusChip,
} from "~/components/tasks/TaskFieldChips";
import { cn } from "~/lib/cn";
import type { TaskStatus } from "~/projects/lib/task-board";
import { primeTaskCard } from "../schema/TaskMentionHoverCard";
import type { DocEditorInstance } from "../schema/build";
import { placeTaskBlock } from "./place-task-block";
import { createTask, dueDateToIso, patchTask, useProjectTeam } from "./task-api";
import { composerCanSubmit, composerNeedsDate, composerStatus, type TaskBlockConfig } from "./task-composer-state";

/** The /task composer, floated over the line it was typed on. It lives outside
 *  the editor's DOM so ProseMirror never sees its keystrokes. */
export function TaskComposer({
  editor,
  anchorId,
  config,
  onClose,
}: {
  editor: DocEditorInstance;
  anchorId: string;
  config: TaskBlockConfig;
  onClose: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [pickedStatus, setPickedStatus] = useState<TaskStatus | null>(null);
  const [owner, setOwner] = useState({ id: "", name: "" });
  const [dueDate, setDueDate] = useState("");
  const [projectId, setProjectId] = useState(config.projectId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const team = useProjectTeam(projectId);

  const status = composerStatus(pickedStatus, dueDate);
  const draft = { title, projectId, status, dueDate };
  const canSubmit = composerCanSubmit(draft) && !busy;

  const anchorEl = useMemo(
    () => editor.domElement?.querySelector<HTMLElement>(`[data-id="${CSS.escape(anchorId)}"]`) ?? null,
    [editor, anchorId],
  );
  const { refs, floatingStyles } = useFloating({
    elements: { reference: anchorEl },
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(({ rects }) => (anchorEl?.textContent ? 4 : -rects.reference.height)),
      size({
        apply({ rects, elements }) {
          elements.floating.style.width = `${rects.reference.width}px`;
        },
      }),
    ],
  });

  const close = () => {
    onClose();
    editor.focus();
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  const titleEmpty = useRef(true);
  titleEmpty.current = !title.trim();

  useEffect(() => {
    // A frame later: the editor reclaims focus as the slash menu closes.
    const frame = requestAnimationFrame(() => titleRef.current?.focus());
    const onPress = (e: MouseEvent) => {
      if (titleEmpty.current && !isInFloatingLayer(e.target)) closeRef.current();
    };
    document.addEventListener("mousedown", onPress);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", onPress);
    };
  }, []);

  async function submit() {
    if (!canSubmit || !projectId) return;
    setBusy(true);
    setError(null);
    const label = title.trim();
    try {
      const { id } = await createTask({ projectId, title: label, status, dueDate });
      const assignees = owner.id ? [{ id: owner.id, name: owner.name }] : [];
      primeTaskCard({
        id,
        title: label,
        status,
        assignee: assignees[0] ?? null,
        assignees,
        dueAt: dueDateToIso(dueDate),
        projectName: config.projects.find((p) => p.id === projectId)?.name ?? "",
      });
      placeTaskBlock(editor, anchorId, { taskId: id, projectId, label });
      onClose();
      if (owner.id) {
        await patchTask(id, { assigneeIds: [owner.id] }).catch(() => toast.error("Task added, but the owner wasn't saved."));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add the task.");
      setBusy(false);
    }
  }

  const projectOptions = useMemo<SelectOption[]>(
    () => config.projects.map((p) => ({ value: p.id, label: p.name })),
    [config.projects],
  );

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        role="group"
        aria-label="New task"
        data-task-composer
        className="z-50 flex flex-col gap-3 rounded-os-card border border-os-container bg-os-bg p-3 shadow-lg"
        onKeyDown={(e) => {
          if (e.key === "Escape" && e.currentTarget.contains(e.target as Node) && !e.defaultPrevented) {
            e.preventDefault();
            close();
          }
        }}
      >
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Task title"
          aria-label="Task title"
          className="!bg-transparent text-[15px] leading-6 text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {!config.projectId && (
            <Combobox
              value={projectId ?? ""}
              options={projectOptions}
              onChange={(next) => {
                setProjectId(next);
                setOwner({ id: "", name: "" });
              }}
              ariaLabel="Project"
              placeholder="Pick project"
              className={cn("w-40", projectId ? TASK_CHIP_CLASS : TASK_CHIP_REQUIRED_CLASS)}
            />
          )}
          <TaskStatusChip value={status} onChange={setPickedStatus} ariaLabel="Status" />
          <TaskOwnerChip
            value={owner.id}
            name={owner.name}
            roster={team}
            rosterLabel="On this project"
            onChange={(id, name) => setOwner({ id, name })}
            ariaLabel="Owner"
            className={cn("w-40", TASK_CHIP_CLASS)}
          />
          <TaskDueChip
            value={dueDate}
            onChange={setDueDate}
            ariaLabel="Due date"
            className="w-32"
            buttonClassName={cn(composerNeedsDate(status, dueDate) ? TASK_CHIP_REQUIRED_CLASS : TASK_CHIP_CLASS, "justify-between")}
          />
          <span className={cn("ml-auto pr-1.5 text-xs", error ? "text-os-danger" : "text-muted-foreground")} role={error ? "alert" : undefined}>
            {error ?? "Esc to cancel"}
          </span>
          <button type="button" onClick={() => void submit()} disabled={!canSubmit} className={buttonClasses("primary", "sm")}>
            {busy ? "Adding…" : error ? "Try again" : "Add task"}
          </button>
        </div>
      </div>
    </FloatingPortal>
  );
}
