import {
  type TimelineEpic,
  type TimelineTerm,
  type StoryDependencyEdge,
  type EpicDependencyEdge,
  type TaskDependencyEdge,
} from "~/projects/components/EpicsTimeline";
import { EpicSprintManager, type EditableEpic } from "~/projects/components/EpicSprintManager";

// Planning holds the epics & sprints manager, rendered as the Gantt timeline
// at the top of Overview.
export function PlanningTab({
  projectId,
  epics,
  editableEpics,
  storyDependencies,
  epicDependencies,
  taskDependencies,
  timelineTerms,
  terms,
  epicTermIds,
  currentTermId,
  canEdit,
  collabToken,
  userName,
  onTaskClick,
  onAddTask,
  reopenEpic,
}: {
  projectId: string;
  epics: TimelineEpic[];
  editableEpics: EditableEpic[];
  storyDependencies: StoryDependencyEdge[];
  epicDependencies: EpicDependencyEdge[];
  taskDependencies: TaskDependencyEdge[];
  timelineTerms: TimelineTerm[];
  terms: { id: string; code: string }[];
  epicTermIds: Record<string, string[]>;
  currentTermId: string | null;
  canEdit: boolean;
  collabToken: string | null;
  userName: string;
  onTaskClick: (taskId: string) => void;
  onAddTask?: (link?: {
    epicId: string;
    storyId: string;
    reopenEpicId?: string;
  }) => void;
  reopenEpic?: { epicId: string } | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      <EpicSprintManager
        projectId={projectId}
        epics={editableEpics}
        terms={terms}
        canManage={canEdit}
        collabToken={collabToken}
        userName={userName}
        timelineEpics={epics}
        storyDependencies={storyDependencies}
        epicDependencies={epicDependencies}
        taskDependencies={taskDependencies}
        timelineTerms={timelineTerms}
        epicTermIds={epicTermIds}
        currentTermId={currentTermId}
        onTaskClick={onTaskClick}
        onAddTask={onAddTask}
        reopenEpic={reopenEpic}
      />
    </div>
  );
}

// Same look as ViewToggle's buttons (the hub's list/cards switch) — that
// component is hardwired to list/card values, so the planning toggle borrows
// its styling rather than its state.
