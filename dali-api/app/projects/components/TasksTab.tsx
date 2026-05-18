import { useEffect, useMemo, useState } from "react";
import { useNavigate, useRevalidator } from "react-router";
import { LayoutGrid, List } from "lucide-react";
import { Button } from "~/components/ui/Button";
import type { Sprint, Epic } from "~/generated/prisma/client";
import type { TaskWithRelations, WorkspaceData } from "~/projects/lib/queries";
import type { ProjectMembership } from "~/lib/projectAuth";
import { TaskBoard } from "./TaskBoard";
import { TaskList } from "./TaskList";
import { TaskDetailModal } from "./TaskDetailModal";
import { TaskCreateInline } from "./TaskCreateInline";
import { useBoardSync } from "./useBoardSync";

interface Data {
  tasks: TaskWithRelations[];
  sprints: Sprint[];
  epics: Epic[];
  view: "board" | "list";
  sprintFilter: string | null;
  epicFilter: string | null;
  collabToken: string | null;
  viewer: { id: string; firstName: string; lastName: string };
}

interface Props {
  data: Data;
  workspace: WorkspaceData;
  membership: ProjectMembership;
}

export function TasksTab({ data, workspace, membership }: Props) {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // Realtime sync: when a peer broadcasts a board event, refresh loader data.
  useBoardSync({
    projectId: workspace.project.id,
    token: data.collabToken,
    userName: `${data.viewer.firstName} ${data.viewer.lastName}`.trim(),
    onPeerEvent: () => revalidator.revalidate(),
  });

  const setQueryParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(window.location.search);
    if (value == null) params.delete(key);
    else params.set(key, value);
    navigate(`/projects/${workspace.project.id}/tasks?${params.toString()}`);
  };

  const filteredTasks = useMemo(() => data.tasks, [data.tasks]);
  const selectedTask = useMemo(
    () => filteredTasks.find((t) => t.id === selectedTaskId) ?? null,
    [filteredTasks, selectedTaskId],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Filter
            label="Sprint"
            value={data.sprintFilter ?? ""}
            onChange={(v) => setQueryParam("sprint", v || null)}
            options={[
              { value: "", label: "All" },
              { value: "backlog", label: "Backlog" },
              ...data.sprints.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
          <Filter
            label="Epic"
            value={data.epicFilter ?? ""}
            onChange={(v) => setQueryParam("epic", v || null)}
            options={[
              { value: "", label: "All" },
              ...data.epics.map((e) => ({ value: e.id, label: e.title })),
            ]}
          />
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle
            view={data.view}
            onChange={(v) => setQueryParam("view", v === "board" ? null : v)}
          />
        </div>
      </div>

      {membership.canEdit && (
        <TaskCreateInline
          projectId={workspace.project.id}
          sprints={data.sprints}
          epics={data.epics}
          defaultSprintId={
            data.sprintFilter === "backlog"
              ? null
              : data.sprintFilter ?? activeSprintId(data.sprints)
          }
          onCreated={() => revalidator.revalidate()}
        />
      )}

      {data.view === "board" ? (
        <TaskBoard
          projectId={workspace.project.id}
          tasks={filteredTasks}
          canEdit={membership.canEdit}
          onSelect={(taskId) => setSelectedTaskId(taskId)}
          onChanged={() => revalidator.revalidate()}
        />
      ) : (
        <TaskList
          tasks={filteredTasks}
          onSelect={(taskId) => setSelectedTaskId(taskId)}
        />
      )}

      {selectedTask && (
        <TaskDetailModal
          projectId={workspace.project.id}
          task={selectedTask}
          sprints={data.sprints}
          epics={data.epics}
          canEdit={membership.canEdit}
          viewer={data.viewer}
          collabToken={data.collabToken}
          onClose={() => setSelectedTaskId(null)}
          onChanged={() => revalidator.revalidate()}
        />
      )}
    </div>
  );
}

function activeSprintId(sprints: Sprint[]): string | null {
  return sprints.find((s) => s.status === "Active")?.id ?? null;
}

function ViewToggle({
  view,
  onChange,
}: {
  view: "board" | "list";
  onChange: (v: "board" | "list") => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-card overflow-hidden">
      <button
        onClick={() => onChange("board")}
        className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 ${
          view === "board"
            ? "bg-accent-coral text-white"
            : "text-muted-foreground hover:text-foreground"
        }`}
        aria-pressed={view === "board"}
      >
        <LayoutGrid className="w-3.5 h-3.5" />
        Board
      </button>
      <button
        onClick={() => onChange("list")}
        className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 ${
          view === "list"
            ? "bg-accent-coral text-white"
            : "text-muted-foreground hover:text-foreground"
        }`}
        aria-pressed={view === "list"}
      >
        <List className="w-3.5 h-3.5" />
        List
      </button>
    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-border bg-card px-2 py-1 text-xs"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
